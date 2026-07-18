#!/usr/bin/env python3
"""
Local Whisper transcription optimised for song lyrics.

Requires:
  pip install faster-whisper

Optional (better quality vocal isolation):
  pip install demucs            # ML source separation — best quality
  pip install noisereduce soundfile  # spectral reduction — lighter fallback

Env:
  WHISPER_MODEL=base|small|medium   (default: small — better than base for lyrics)
  WHISPER_LANGUAGE=fr               (STRONGLY recommended — auto-detect fails on music)
  VOCAL_ISOLATION=1                 (default: 1 — pre-process audio)

CLI:
  transcribe_audio.py <audio_file> [--start-time FLOAT] [--duration FLOAT]

  --start-time  Audio offset in seconds (trims audio before transcribing so
                timestamps match the montage video timeline which starts at 0).
  --duration    Duration in seconds to transcribe. Trims tail of audio.
"""

import sys
import json
import os
import shutil
import subprocess
import tempfile
import argparse


# ─── CLI args ─────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="Transcribe audio for montage subtitles")
    parser.add_argument("audio_file", help="Path to the audio file")
    parser.add_argument("--start-time", type=float, default=0.0,
                        help="Start offset in seconds (trims audio before transcribing)")
    parser.add_argument("--duration", type=float, default=0.0,
                        help="Duration to transcribe in seconds (0 = full file)")
    return parser.parse_args()


# ─── Audio trimming ───────────────────────────────────────────────────────────

def trim_audio(audio_path: str, start_time: float, duration: float, tmp_dir: str) -> str:
    """
    Trim audio to [start_time, start_time + duration] before transcription.
    This ensures Whisper only sees the exact segment used in the video, so
    its 0-based timestamps match the video timeline directly.
    """
    out = os.path.join(tmp_dir, "trimmed.wav")
    cmd = ["ffmpeg", "-y"]
    if start_time > 0:
        cmd += ["-ss", str(start_time)]
    if duration > 0:
        cmd += ["-t", str(duration)]
    cmd += ["-i", audio_path, "-ar", "16000", "-ac", "1", out]
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    if result.returncode == 0 and os.path.isfile(out):
        return out
    return audio_path


# ─── Audio pre-processing ─────────────────────────────────────────────────────

def _ffmpeg_vocal_enhance(audio_path: str, tmp_dir: str):
    """
    Use ffmpeg to pre-process audio for voice recognition:
     - Mix stereo to mono  (centre-panned vocals preserved, wide instruments reduced)
     - High-pass 80 Hz     (removes kick/bass)
     - Low-pass  8 kHz     (removes hi-hats, cymbals, noise)
     - Loudness normalize  (Whisper prefers consistent levels)
     - Resample to 16 kHz  (Whisper's optimal rate — also reduces file size)
    No extra Python packages needed beyond ffmpeg being on PATH.
    """
    out = os.path.join(tmp_dir, "enhanced.wav")
    af = (
        "pan=mono|c0=0.5*c0+0.5*c1,"
        "highpass=f=80,"
        "lowpass=f=8000,"
        "loudnorm"
    )
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path,
         "-af", af, "-ar", "16000", "-ac", "1", out],
        capture_output=True, timeout=120,
    )
    return out if result.returncode == 0 and os.path.isfile(out) else None


def _try_demucs(audio_path: str, tmp_dir: str):
    """Separate vocals with demucs (best quality). Install: pip install demucs"""
    try:
        import importlib
        if importlib.util.find_spec("demucs") is None:
            return None
        base = os.path.splitext(os.path.basename(audio_path))[0]
        result = subprocess.run(
            [sys.executable, "-m", "demucs",
             "--two-stems=vocals", "--device", "cpu", "-o", tmp_dir, audio_path],
            capture_output=True, timeout=900,
        )
        if result.returncode != 0:
            return None
        for model_dir in ("htdemucs", "htdemucs_ft", "mdx_extra_q", "mdx_extra"):
            for ext in ("wav", "mp3"):
                cand = os.path.join(tmp_dir, model_dir, base, f"vocals.{ext}")
                if os.path.isfile(cand):
                    return cand
    except Exception:
        pass
    return None


def _try_noisereduce(audio_path: str, tmp_dir: str):
    """Spectral noise reduction. Install: pip install noisereduce soundfile"""
    try:
        import noisereduce as nr
        import soundfile as sf
        import numpy as np  # noqa
        data, rate = sf.read(audio_path, always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        reduced = nr.reduce_noise(y=data, sr=rate, stationary=False, prop_decrease=0.75)
        out = os.path.join(tmp_dir, "denoised.wav")
        sf.write(out, reduced, rate)
        return out
    except (ImportError, Exception):
        return None


def isolate_vocals(audio_path: str):
    """
    Isolation cascade (best → lightest):
      1. demucs       — full ML source separation (optional, best quality)
      2. noisereduce  — spectral subtraction (optional, moderate)
      3. ffmpeg       — frequency filter + normalize (always available)
      4. original     — no processing
    Returns (clean_path, cleanup_fn).
    """
    if os.environ.get("VOCAL_ISOLATION", "1") == "0":
        return audio_path, lambda: None

    tmp = tempfile.mkdtemp(prefix="vocals_iso_")
    cleanup = lambda: shutil.rmtree(tmp, ignore_errors=True)

    result = _try_demucs(audio_path, tmp)
    if result:
        return result, cleanup

    result = _try_noisereduce(audio_path, tmp)
    if result:
        return result, cleanup

    # Fallback: always-available ffmpeg filter chain
    result = _ffmpeg_vocal_enhance(audio_path, tmp)
    if result:
        return result, cleanup

    cleanup()
    return audio_path, lambda: None


# ─── Word → line grouping ─────────────────────────────────────────────────────

def group_into_lines(segments_iter, max_words=4, max_duration=2.5, min_pause=0.5):
    """
    Convert word-level Whisper segments into display-ready subtitle lines.
    Parameters tuned for MUSIC LYRICS:
      - min_pause=0.5s  : singers take short breaths; only split on real phrase gaps
      - max_words=4     : short lines feel tighter and more sync'd to the beat
      - max_duration=2.5: avoid long-running subtitles that drift from the sung phrase

    A new line starts when:
      - There is a pause > min_pause seconds between words
      - The current line already has >= max_words words
      - The current line duration would exceed max_duration seconds

    Returns a list of {"start", "end", "text"} dicts with word-precise timings.
    """
    lines = []

    for seg in segments_iter:
        words = getattr(seg, "words", None)
        if not words:
            # Segment without word timestamps — use segment as a single line
            text = seg.text.strip()
            if text:
                lines.append({
                    "start": round(seg.start, 3),
                    "end":   round(seg.end,   3),
                    "text":  text,
                })
            continue

        current_words = []

        for word in words:
            wtext = (getattr(word, "word", "") or "").strip()
            if not wtext:
                continue

            if current_words:
                pause = word.start - current_words[-1].end
                line_dur = word.end - current_words[0].start
                if (pause > min_pause
                        or len(current_words) >= max_words
                        or line_dur > max_duration):
                    # Flush current line
                    lines.append({
                        "start": round(current_words[0].start, 3),
                        "end":   round(current_words[-1].end + 0.05, 3),
                        "text":  " ".join(
                            (getattr(w, "word", "") or "").strip()
                            for w in current_words
                        ).strip(),
                    })
                    current_words = []

            current_words.append(word)

        # Flush remaining words
        if current_words:
            lines.append({
                "start": round(current_words[0].start, 3),
                "end":   round(current_words[-1].end + 0.05, 3),
                "text":  " ".join(
                    (getattr(w, "word", "") or "").strip()
                    for w in current_words
                ).strip(),
            })

    return [l for l in lines if l["text"]]


# ─── Transcription ────────────────────────────────────────────────────────────

def transcribe(audio_path: str):
    from faster_whisper import WhisperModel

    # "small" gives significantly better lyrics accuracy than "base" with acceptable CPU time.
    # The server route caps at "medium" for RAM reasons; user can pass ?model=medium for best quality.
    model_size = os.environ.get("WHISPER_MODEL", "small")
    language   = os.environ.get("WHISPER_LANGUAGE") or None
    device     = "cpu"
    compute    = "int8"

    # Language-specific primer oriented towards RAP / autotune lyrics.
    # A concrete stylistic hint dramatically improves Whisper accuracy on music.
    lang_hints = {
        "fr": "Paroles de rap ou de chanson en français, rythmées, avec autotune :",
        "en": "Rap or song lyrics in English, rhythmic flow, autotune:",
        "es": "Letra de rap o canción en español, flujo rítmico:",
        "de": "Rap- oder Liedtext auf Deutsch, rhythmisch:",
        "pt": "Letra de rap ou música em português, rítmica:",
        "it": "Testo rap o canzone in italiano, ritmico:",
    }
    initial_prompt = lang_hints.get(language or "", "Rap or song lyrics:")

    clean_path, cleanup = isolate_vocals(audio_path)
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute)
        segments_iter, info = model.transcribe(
            clean_path,
            language=language,
            beam_size=5,
            best_of=5,
            # KEY: prevents Whisper looping the same phrase endlessly on music
            condition_on_previous_text=False,
            # Temperature fallback: greedy first, then sampling if quality is poor
            temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            # --- Thresholds loosened for RAP / autotune vocals ---
            # Rap has repetitive patterns → high compression ratio is NORMAL, not a hallucination signal
            compression_ratio_threshold=2.4,   # was 1.8
            # Autotuned vocals have lower log-probability; don't reject them
            log_prob_threshold=-1.5,            # was -1.0
            # Heavily processed vocals look like "no speech" to the VAD; raise threshold
            no_speech_threshold=0.65,           # was 0.4
            vad_filter=True,
            vad_parameters={
                # Shorter silence gap → fewer blank periods between rap phrases
                "min_silence_duration_ms": 150,   # was 300
                # Larger pad → captures leading/trailing syllables at phrase edges
                "speech_pad_ms": 400,             # was 200
            },
            # word_timestamps=True gives per-word timing for precise subtitle sync
            word_timestamps=True,
            initial_prompt=initial_prompt,
        )

        # Collect all segments (iterator is consumed by group_into_lines)
        segments_list = list(segments_iter)

        # Remove CONSECUTIVE duplicate segments only (Whisper hallucination = same phrase
        # repeated back-to-back).  Do NOT remove non-consecutive repeats — chorus /
        # hook lines are real lyrics that genuinely recur throughout the song.
        deduped = []
        prev_norm = None
        for seg in segments_list:
            norm = (seg.text or "").strip().lower().strip(".,!?¿¡ ")
            if norm and len(norm) >= 2 and norm != prev_norm:
                deduped.append(seg)
                prev_norm = norm

        # Group words into natural subtitle lines with precise timings
        segments = group_into_lines(deduped)

    finally:
        cleanup()

    return segments, info.language


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = parse_args()

    audio = args.audio_file
    if not os.path.isfile(audio):
        print(json.dumps({"error": f"Fichier introuvable : {audio}"}))
        sys.exit(1)

    try:
        # If a time range is specified, trim the audio first so that
        # Whisper timestamps are 0-based and match the video timeline directly.
        if args.start_time > 0 or args.duration > 0:
            tmp_trim = tempfile.mkdtemp(prefix="montage_trim_")
            try:
                audio = trim_audio(audio, args.start_time, args.duration, tmp_trim)
                segs, lang = transcribe(audio)
            finally:
                shutil.rmtree(tmp_trim, ignore_errors=True)
        else:
            segs, lang = transcribe(audio)

        print(json.dumps({"segments": segs, "language": lang}))
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper non installé. Exécutez : pip install faster-whisper"
        }))
        sys.exit(2)



# ─── Audio pre-processing ─────────────────────────────────────────────────────

