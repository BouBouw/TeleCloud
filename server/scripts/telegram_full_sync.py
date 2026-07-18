#!/usr/bin/env python3
"""
Full Telegram channel audio sync using Telethon (MTProto API).
Iterates the ENTIRE channel history — no 100-message Bot API limit.

Requirements:
  pip install telethon

Env vars (set in /var/www/vibot/server/.env):
  TELEGRAM_API_ID    — from https://my.telegram.org (integer)
  TELEGRAM_API_HASH  — from https://my.telegram.org (string)

Usage:
  python telegram_full_sync.py <bot_token> <channel_id> <output_dir> <storage_root>

Prints JSON lines to stdout (one per event):
  { "status": "start",    "total": N }
  { "status": "progress", "count": N, "title": "...", "imported": N, "skipped": N, "result": {...} }
  { "status": "warning",  "title": "...", "error": "..." }
  { "status": "done",     "total": N }
  { "status": "error",    "error": "..." }
"""

import sys
import json

import asyncio
import os
import re
import hashlib

def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)

async def main() -> None:
    # ── Telethon import ──────────────────────────────────────────────────────
    try:
        from telethon import TelegramClient
        from telethon.tl.types import (
            DocumentAttributeAudio,
            DocumentAttributeFilename,
        )
        from telethon.tl.functions.channels import GetFullChannelRequest
    except ImportError:
        emit({"status": "error",
              "error": "Telethon non installé. Exécutez : pip install telethon"})
        sys.exit(1)

    # ── Args ─────────────────────────────────────────────────────────────────
    if len(sys.argv) < 5:
        emit({"status": "error",
              "error": "Usage: script <bot_token> <channel_id> <output_dir> <storage_root>"})
        sys.exit(1)

    bot_token    = sys.argv[1]
    _channel_id_raw = sys.argv[2]
    # Telethon requires an integer for numeric channel IDs (not a string,
    # which it would misinterpret as a phone number).
    try:
        channel_id: int | str = int(_channel_id_raw)
    except ValueError:
        channel_id = _channel_id_raw  # username like @channelname
    output_dir   = sys.argv[3]
    storage_root = sys.argv[4]

    # ── API credentials ───────────────────────────────────────────────────────
    raw_api_id   = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash     = os.environ.get("TELEGRAM_API_HASH", "").strip()

    if not raw_api_id or not api_hash:
        emit({
            "status": "error",
            "error": (
                "TELEGRAM_API_ID et TELEGRAM_API_HASH manquants dans .env. "
                "Obtenez-les sur https://my.telegram.org → API development tools."
            )
        })
        sys.exit(1)

    try:
        api_id = int(raw_api_id)
    except ValueError:
        emit({"status": "error", "error": f"TELEGRAM_API_ID invalide : {raw_api_id!r}"})
        sys.exit(1)

    # ── Paths ─────────────────────────────────────────────────────────────────
    os.makedirs(output_dir, exist_ok=True)
    sessions_dir = os.path.join(storage_root, "_tg_sessions")
    os.makedirs(sessions_dir, exist_ok=True)

    # One session file per bot token (hashed so no secrets on disk)
    session_name = os.path.join(
        sessions_dir,
        "bot_" + hashlib.md5(bot_token.encode()).hexdigest()[:12]
    )

    MIME_TO_EXT: dict[str, str] = {
        "audio/mpeg": "mp3", "audio/mp3": "mp3",
        "audio/ogg":  "ogg",
        "audio/wav":  "wav", "audio/x-wav": "wav",
        "audio/flac": "flac",
        "audio/x-m4a": "m4a", "audio/mp4": "m4a",
        "audio/aac":  "m4a",
    }

    # ── Connect ───────────────────────────────────────────────────────────────
    # NOTE: Do NOT use `async with TelegramClient(...) as client:` — that calls
    # start() with no args which prompts for phone number (stdin EOF crash).
    # Use explicit connect → start(bot_token=...) → disconnect instead.
    client = TelegramClient(session_name, api_id, api_hash)
    try:
        await client.connect()
        await client.start(bot_token=bot_token)

        # Resolve channel entity
        try:
            entity = await client.get_entity(channel_id)
        except Exception as exc:
            emit({"status": "error",
                  "error": f"Canal introuvable ({channel_id}): {exc}"})
            return

        # Get max message ID via GetFullChannelRequest.pts
        # Bots cannot use GetHistoryRequest or SearchRequest (BotMethodInvalidError),
        # so we iterate by explicit message IDs using channels.getMessages.
        max_msg_id = 0
        try:
            full = await client(GetFullChannelRequest(entity))
            max_msg_id = getattr(full.full_chat, 'pts', 0) or 0
        except Exception:
            pass

        if max_msg_id <= 0:
            # Fallback: probe exponentially to find a rough upper bound
            for probe in [100, 500, 2000, 10000, 50000]:
                probe_msgs = await client.get_messages(entity, ids=[probe])
                if probe_msgs and probe_msgs[0] is not None:
                    max_msg_id = probe
            max_msg_id = (max_msg_id or 500) * 3  # generous upper bound

        max_msg_id = max(max_msg_id, 100)

        emit({"status": "start", "total": max_msg_id})

        count = 0
        BATCH = 100  # channels.getMessages accepts up to 100 IDs per call

        # Iterate ALL message IDs in ascending order, filtering for audio
        for batch_start in range(1, max_msg_id + 1, BATCH):
            ids = list(range(batch_start, min(batch_start + BATCH, max_msg_id + 1)))
            try:
                messages = await client.get_messages(entity, ids=ids)
            except Exception:
                continue

            for message in messages:
                if message is None:
                    continue

                doc = message.audio or message.document
                if doc is None:
                    continue

                # Verify it has audio attributes
                has_audio = False
                for attr in getattr(doc, "attributes", []):
                    if isinstance(attr, DocumentAttributeAudio):
                        has_audio = True
                        break
                if not has_audio:
                    continue

                # ── Extract metadata ──────────────────────────────────────
                title: str | None = None
                artist            = "Telegram"
                duration: int | None = None
                orig_filename: str | None = None

                for attr in getattr(doc, "attributes", []):
                    if isinstance(attr, DocumentAttributeAudio):
                        if getattr(attr, "title", None):
                            title = attr.title
                        if getattr(attr, "performer", None):
                            artist = attr.performer
                        if getattr(attr, "duration", None):
                            duration = attr.duration
                    elif isinstance(attr, DocumentAttributeFilename):
                        orig_filename = attr.file_name

                if not title:
                    if orig_filename:
                        title = re.sub(
                            r"\.[a-z0-9]{2,5}$", "", orig_filename, flags=re.IGNORECASE
                        ).strip()
                    elif message.message:
                        title = message.message[:80].strip()
                    else:
                        title = f"Telegram audio {message.id}"

                # ── Extension / unique key ────────────────────────────────
                mime = getattr(doc, "mime_type", "audio/mpeg") or "audio/mpeg"
                ext  = MIME_TO_EXT.get(mime, "mp3")
                if orig_filename and "." in orig_filename:
                    candidate = orig_filename.rsplit(".", 1)[-1].lower()
                    if candidate in ("mp3", "ogg", "wav", "flac", "m4a", "aac", "opus"):
                        ext = candidate

                file_unique_id = f"tg_{doc.id}"
                out_path       = os.path.join(output_dir, f"{file_unique_id}.{ext}")
                rel_path       = os.path.relpath(out_path, storage_root)

                already_exists = os.path.exists(out_path)
                file_size      = 0

                if not already_exists:
                    try:
                        await client.download_media(message, file=out_path)
                        file_size = os.path.getsize(out_path)
                    except Exception as exc:
                        emit({"status": "warning",
                              "title": title,
                              "error": str(exc)})
                        continue
                else:
                    file_size = os.path.getsize(out_path)

                count += 1
                result = {
                    "fileUniqueId": file_unique_id,
                    "filePath":     rel_path,
                    "title":        title,
                    "artist":       artist,
                    "duration":     duration,
                    "fileSize":     file_size,
                    "messageId":    message.id,
                    "alreadyExists": already_exists,
                }
                emit({
                    "status":  "progress",
                    "count":   count,
                    "title":   title,
                    "result":  result,
                })

        emit({"status": "done", "total": count})

    except Exception as exc:
        emit({"status": "error", "error": str(exc)})
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(json.dumps({"status": "error", "error": f"Fatal: {e}"}), flush=True)
