import { useEffect, useRef } from 'react'

/** Vertical-drag stereo pan knob (-1 .. 1). */
export function PanKnob({ pan, onChange, color }: { pan: number; onChange: (v: number) => void; color: string }) {
  const dragY = useRef<number | null>(null)
  const dragPan = useRef(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragY.current === null) return
      const delta = (dragY.current - e.clientY) / 80
      onChangeRef.current(Math.max(-1, Math.min(1, dragPan.current + delta)))
    }
    const onUp = () => { dragY.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  const angle = pan * 140
  return (
    <div title={`Pan: ${pan >= 0 ? 'R' : 'L'}${Math.round(Math.abs(pan) * 100)}`}
      onMouseDown={e => { dragY.current = e.clientY; dragPan.current = pan; e.preventDefault() }}
      onDoubleClick={() => onChange(0)}
      style={{ width: 28, height: 28, borderRadius: '50%', cursor: 'ns-resize', userSelect: 'none', position: 'relative',
        background: 'radial-gradient(circle at 35% 32%, #3c3c3c, #111)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 0 #3a3a3a' }}>
      <div style={{ position: 'absolute', bottom: '50%', left: '50%', width: 1.5, height: 10,
        transformOrigin: 'bottom center', transform: `translateX(-50%) rotate(${angle}deg)`,
        background: color, borderRadius: 1 }} />
      {pan !== 0 && <div style={{ position: 'absolute', inset: -1, borderRadius: '50%', border: `1.5px solid ${color}30` }} />}
    </div>
  )
}
