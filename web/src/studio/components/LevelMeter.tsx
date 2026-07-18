import { useEffect, useRef } from 'react'

/**
 * Live output level meter driven by the engine's master AnalyserNode.
 * Shows an RMS bar (green→amber→red) with a falling peak-hold marker.
 */
export function LevelMeter({ analyser, width = 88, height = 12 }: {
  analyser: () => AnalyserNode | null
  width?: number
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peakRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let raf = 0
    let buf: Uint8Array<ArrayBuffer> | null = null

    const draw = () => {
      const an = analyser()
      let rms = 0
      if (an) {
        if (!buf || buf.length !== an.fftSize) buf = new Uint8Array(an.fftSize)
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        rms = Math.sqrt(sum / buf.length)
      }
      // gentle boost so typical program material reaches most of the meter
      const level = Math.min(1, rms * 1.8)
      peakRef.current = Math.max(level, peakRef.current - 0.02)

      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, width, height)
      const grad = ctx.createLinearGradient(0, 0, width, 0)
      grad.addColorStop(0, '#2eb872'); grad.addColorStop(0.7, '#2eb872')
      grad.addColorStop(0.85, '#f0a830'); grad.addColorStop(1, '#e74c3c')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, width * level, height)
      // peak-hold marker
      const px = Math.min(width - 1, width * peakRef.current)
      ctx.fillStyle = peakRef.current > 0.95 ? '#e74c3c' : '#eee'
      ctx.fillRect(px, 0, 1.5, height)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analyser, width, height])

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 2, display: 'block' }} title="Niveau de sortie" />
}
