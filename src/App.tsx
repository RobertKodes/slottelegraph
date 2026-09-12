import { useCallback, useEffect, useRef, useState } from 'react'
import { TelegraphDesk } from './engine/desk.ts'
import { useChainPulse } from './hooks/useChainPulse.ts'
import { SounderClick } from './lib/click.ts'
import { FAMILIES, familyColor, familyLabel, type Family } from './lib/programs.ts'

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const deskRef = useRef<TelegraphDesk | null>(null)
  const clickRef = useRef<SounderClick | null>(null)
  if (!deskRef.current) deskRef.current = new TelegraphDesk()
  if (!clickRef.current) clickRef.current = new SounderClick()

  const reduced = usePrefersReducedMotion()
  const [held, setHeld] = useState(false)
  const [ear, setEar] = useState(false)
  const heldRef = useRef(false)
  const reducedRef = useRef(reduced)
  heldRef.current = held
  reducedRef.current = reduced

  const { hud, pull } = useChainPulse(held)
  const pullRef = useRef(pull)
  pullRef.current = pull
  const hudRef = useRef(hud)
  hudRef.current = hud

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    const desk = deskRef.current!
    let raf = 0
    let last = performance.now()

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const parent = canvas.parentElement ?? canvas
      const rect = parent.getBoundingClientRect()
      const cssW = Math.max(1, rect.width)
      const cssH = Math.max(1, rect.height)
      const w = Math.max(1, Math.floor(cssW * dpr))
      const h = Math.max(1, Math.floor(cssH * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas.parentElement ?? canvas)

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const pulse = hudRef.current
      desk.frozen = heldRef.current
      desk.reduced = reducedRef.current
      desk.fee = pulse.fee
      desk.live = pulse.live
      desk.degraded = pulse.degraded
      if (pulse.slot != null) desk.setSlot(pulse.slot, now)
      desk.step(dt, now, () => pullRef.current())
      const clicks = desk.drainClicks()
      const clicker = clickRef.current
      if (clicker && !reducedRef.current) {
        for (const failed of clicks) clicker.tick(failed)
      }
      const parent = canvas.parentElement ?? canvas
      const rect = parent.getBoundingClientRect()
      desk.draw(ctx, rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2), now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const toggleBreak = useCallback(() => {
    setHeld((s) => !s)
  }, [])

  const toggleEar = useCallback(() => {
    const click = clickRef.current!
    if (click.enabled) {
      click.mute()
      setEar(false)
      return
    }
    void click.unmute().then((ok) => setEar(ok))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      e.preventDefault()
      toggleBreak()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleBreak])

  const slot = hud.slot != null ? hud.slot.toLocaleString('en-US') : '—'
  const tps = hud.tps != null ? Math.round(hud.tps).toLocaleString('en-US') : '—'
  const rtt = hud.rttMs != null ? `${Math.round(hud.rttMs)}` : '—'
  const live = hud.live && !held

  return (
    <div className={`office${held ? ' held' : ''}`}>
      <div className="stage">
        <canvas ref={canvasRef} className="desk" aria-hidden />
      </div>

      <header className="mast">
        <p className="kicker">night wire · coal-oil · confirmed slot · mainnet</p>
        <h1>Slottelegraph</h1>
        <p className="lede">the chain, as a Victorian telegraph office</p>
      </header>

      <aside className="plate" aria-label="instrument strip">
        <p className="plate-mark">RK · DESK 01 · {hud.degraded ? 'degraded' : hud.host}</p>

        <button
          type="button"
          className={`break-key${held ? ' on' : ''}`}
          onClick={toggleBreak}
          aria-pressed={held}
        >
          <span className="knife" aria-hidden>
            <i />
          </span>
          <span className="break-copy">
            <em>{held ? 'held' : 'live'}</em>
            {held ? 'RESUME' : 'BREAK'}
          </span>
        </button>

        <dl className="strip">
          <Readout k="slot" v={slot} live={live} />
          <Readout k="approx tps" v={tps} live={live} />
          <Readout k="rpc rtt" v={rtt} unit="ms" live={live} />
        </dl>

        <div className="heat" aria-hidden>
          <span>idle</span>
          <i>
            <b style={{ width: `${Math.round(hud.fee * 100)}%` }} />
          </i>
          <span>busy</span>
        </div>

        <ul className="legend">
          {FAMILIES.map((f) => (
            <li key={f}>
              <i style={{ background: familyColor(f as Family) }} />
              {familyLabel(f as Family)}
            </li>
          ))}
          <li>
            <i className="fail" />
            torn / garbled
          </li>
        </ul>

        <div className="plate-row">
          <button type="button" className={`ear${ear ? ' on' : ''}`} onClick={toggleEar}>
            {ear ? 'sounder on' : 'sounder mute'}
          </button>
          <p className="hint">Space holds the break. Release to resume the wire.</p>
        </div>
      </aside>
    </div>
  )
}

function Readout({
  k,
  v,
  unit,
  live,
}: {
  k: string
  v: string
  unit?: string
  live: boolean
}) {
  return (
    <div className={`read${live ? ' live' : ''}`}>
      <dt>{k}</dt>
      <dd>
        {v}
        {unit ? <em>{unit}</em> : null}
      </dd>
    </div>
  )
}
