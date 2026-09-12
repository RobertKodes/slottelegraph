import { familyColor, familyLabel, type Family } from '../lib/programs.ts'
import { garbleMorse, stampMorse } from '../lib/morse.ts'
import { INK, PALETTE } from '../lib/palette.ts'

export type TapeSpec = {
  family: Family
  sig: string
  failed: boolean
}

type Line = TapeSpec & {
  short: string
  morse: string
  torn: boolean
  smudge: number
  tick: number
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number }

type Layout = {
  w: number
  h: number
  deskY: number
  blot: { x: number; y: number; w: number; h: number }
  sounder: { x: number; y: number; s: number }
  reel: { x: number; y: number; r: number }
  inker: { x: number; y: number }
  lamp: { x: number; y: number; s: number }
  key: { x: number; y: number; s: number }
  tapeY: number
  tapeH: number
}

const LINGER_FAIL = 520
const ARM_HOLD = 0.075

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a)
  const [br, bg, bb] = hexRgb(b)
  const r = Math.round(lerp(ar, br, t))
  const g = Math.round(lerp(ag, bg, t))
  const bl = Math.round(lerp(ab, bb, t))
  return `rgb(${r},${g},${bl})`
}

function toLine(spec: TapeSpec, tick: number): Line {
  const seed = hash32(spec.sig)
  const morse = spec.failed ? garbleMorse(stampMorse(spec.sig), seed) : stampMorse(spec.sig)
  return {
    ...spec,
    short: spec.sig.slice(0, 4).toUpperCase(),
    morse,
    torn: spec.failed && seed % 2 === 0,
    smudge: spec.failed ? 0.45 + (seed % 40) / 100 : 0.08,
    tick,
  }
}

function placeholder(tick: number): Line {
  return {
    family: '???',
    sig: `wait:${tick}`,
    failed: false,
    short: 'WAIT',
    morse: '·−−  ·',
    torn: false,
    smudge: 0.04,
    tick,
  }
}

export class TelegraphDesk {
  frozen = false
  reduced = false
  fee = 0.1
  live = false
  degraded = false
  slot: number | null = null
  lastClickFailed = false

  private lastSlot = -1
  private pending = false
  private extras = 0
  private lingerUntil = 0
  private tapeHead = 0
  private scroll = 0
  private lines: Line[] = []
  private arm = 0
  private armTarget = 0
  private armHold = 0
  private jitter = 0
  private flicker = 0
  private sparks: Spark[] = []
  private clickQueue: boolean[] = []

  setSlot(slot: number, now: number) {
    if (slot === this.lastSlot) return
    const first = this.lastSlot < 0
    this.lastSlot = slot
    this.slot = slot
    if (first) {
      this.pending = true
      return
    }
    if (this.frozen) return
    this.pending = true
    void now
  }

  drainClicks(): boolean[] {
    if (!this.clickQueue.length) return []
    const out = this.clickQueue.splice(0, this.clickQueue.length)
    return out
  }

  step(dt: number, now: number, pull: () => TapeSpec | null) {
    if (!this.frozen && now >= this.lingerUntil) {
      if (this.pending) {
        this.pending = false
        this.extras = this.fee > 0.62 ? 2 : this.fee > 0.36 ? 1 : 0
        this.print(pull, now, true)
      } else if (this.extras > 0) {
        this.extras -= 1
        this.print(pull, now, false)
      }
    }

    const hold = this.armHold > 0
    if (!this.frozen) {
      this.armHold = Math.max(0, this.armHold - dt)
      if (!hold && this.armHold === 0 && now >= this.lingerUntil) this.armTarget = 0
    }

    if (now < this.lingerUntil && !this.frozen && !this.reduced) {
      this.jitter = Math.sin(now * 0.062) * 0.55 + Math.sin(now * 0.11) * 0.25
      this.armTarget = 0.55 + this.jitter * 0.45
    } else {
      this.jitter *= 0.85
    }

    const k = this.reduced ? 1 : Math.min(1, dt * 22)
    this.arm += (this.armTarget - this.arm) * k

    const goal = this.tapeHead
    if (this.reduced) this.scroll = goal
    else this.scroll += (goal - this.scroll) * Math.min(1, dt * 10)

    if (!this.frozen && !this.reduced) {
      const n = Math.sin(now * 0.008) * 0.04 + (Math.random() - 0.5) * (0.08 + this.fee * 0.35)
      this.flicker += (n - this.flicker) * Math.min(1, dt * 8)
    } else if (this.reduced) {
      this.flicker = 0
    }

    if (this.frozen || this.reduced) {
      this.sparks.length = 0
    } else {
      for (const s of this.sparks) {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vy += 80 * dt
        s.life -= dt
      }
      this.sparks = this.sparks.filter((s) => s.life > 0)
    }

    if (this.lines.length > 48) this.lines.splice(0, this.lines.length - 48)
  }

  private print(pull: () => TapeSpec | null, now: number, fromSlot: boolean) {
    const spec = pull()
    const line = spec ? toLine(spec, this.tapeHead) : fromSlot ? placeholder(this.tapeHead) : null
    if (!line) return
    this.lines.push(line)
    this.tapeHead += 1
    this.armTarget = 1
    this.armHold = ARM_HOLD
    this.lastClickFailed = line.failed
    this.clickQueue.push(line.failed)
    if (line.failed) this.lingerUntil = now + LINGER_FAIL
    this.spawnSparks()
  }

  private spawnSparks() {
    if (this.reduced) return
    const n = 1 + Math.round(this.fee * 10)
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * 0.2 - Math.random() * Math.PI * 0.7
      const sp = 40 + Math.random() * 90 * (0.4 + this.fee)
      this.sparks.push({
        x: 0,
        y: 0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.12 + Math.random() * 0.18,
        max: 0.3,
      })
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, _dpr: number, now: number) {
    const L = this.layout(w, h)
    ctx.clearRect(0, 0, w, h)
    this.drawRoom(ctx, L)
    this.drawDesk(ctx, L)
    this.drawBlotter(ctx, L)
    this.drawLampGlow(ctx, L)
    this.drawKey(ctx, L)
    this.drawSounder(ctx, L, now)
    this.drawTape(ctx, L)
    this.drawLamp(ctx, L)
    this.drawSparks(ctx, L)
    this.drawVignette(ctx, L)
  }

  private layout(w: number, h: number): Layout {
    const narrow = w < 740
    const deskY = h * (narrow ? 0.34 : 0.3)
    const blotW = w * (narrow ? 0.92 : 0.86)
    const blotH = h * (narrow ? 0.5 : 0.52)
    const blotX = (w - blotW) / 2
    const blotY = deskY + h * 0.06
    const s = Math.min(w, h) * (narrow ? 0.11 : 0.095)
    const sounderX = blotX + blotW * (narrow ? 0.22 : 0.2)
    const sounderY = blotY + blotH * 0.42
    const reelX = blotX + blotW * (narrow ? 0.4 : 0.38)
    const reelY = sounderY - s * 0.15
    return {
      w,
      h,
      deskY,
      blot: { x: blotX, y: blotY, w: blotW, h: blotH },
      sounder: { x: sounderX, y: sounderY, s },
      reel: { x: reelX, y: reelY, r: s * 0.42 },
      inker: { x: reelX + s * 0.85, y: reelY + s * 0.12 },
      lamp: {
        x: blotX + blotW * (narrow ? 0.82 : 0.84),
        y: deskY + h * 0.02,
        s: s * 1.15,
      },
      key: { x: sounderX - s * 0.15, y: sounderY + s * 1.15, s: s * 0.85 },
      tapeY: reelY + s * 0.08,
      tapeH: s * 0.52,
    }
  }

  private drawRoom(ctx: CanvasRenderingContext2D, L: Layout) {
    const { w, h, deskY } = L
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#0A0C0A')
    g.addColorStop(0.45, PALETTE.pitch)
    g.addColorStop(1, '#0E0C08')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.55)
    ctx.fillRect(0, deskY - 18, w, 22)
    const grain = mulberry32(11)
    ctx.strokeStyle = rgba(PALETTE.oak, 0.18)
    ctx.lineWidth = 1
    for (let i = 0; i < 14; i++) {
      const y = deskY - 16 + i * 1.3
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x < w; x += 28) {
        ctx.lineTo(x, y + (grain() - 0.5) * 1.6)
      }
      ctx.stroke()
    }
  }

  private drawDesk(ctx: CanvasRenderingContext2D, L: Layout) {
    const { w, h, deskY } = L
    const top = ctx.createLinearGradient(0, deskY, 0, h)
    top.addColorStop(0, mix(PALETTE.oak, PALETTE.amber, 0.12))
    top.addColorStop(0.15, PALETTE.oak)
    top.addColorStop(1, mix(PALETTE.oak, PALETTE.pitch, 0.45))
    ctx.fillStyle = top
    ctx.fillRect(0, deskY, w, h - deskY)

    const rng = mulberry32(42)
    ctx.strokeStyle = rgba(PALETTE.pitch, 0.22)
    ctx.lineWidth = 1
    for (let i = 0; i < 36; i++) {
      const y = deskY + 8 + rng() * (h - deskY)
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x < w; x += 40) {
        ctx.lineTo(x, y + (rng() - 0.5) * 3)
      }
      ctx.stroke()
    }

    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.5)
    ctx.fillRect(0, h - 18, w, 18)
    ctx.fillStyle = rgba(PALETTE.pitch, 0.35)
    ctx.fillRect(0, deskY, w, 4)
  }

  private drawBlotter(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y, w, h } = L.blot
    ctx.save()
    roundRect(ctx, x, y, w, h, 10)
    const felt = ctx.createLinearGradient(x, y, x + w * 0.2, y + h)
    felt.addColorStop(0, mix(PALETTE.baize, PALETTE.amber, 0.08))
    felt.addColorStop(0.5, PALETTE.baize)
    felt.addColorStop(1, mix(PALETTE.baize, PALETTE.pitch, 0.28))
    ctx.fillStyle = felt
    ctx.fill()

    const rng = mulberry32(99)
    ctx.globalAlpha = 0.07
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = rng() > 0.5 ? PALETTE.ivory : PALETTE.pitch
      ctx.fillRect(x + rng() * w, y + rng() * h, 1.2, 1.2)
    }
    ctx.globalAlpha = 1

    ctx.strokeStyle = rgba(PALETTE.brass, 0.35)
    ctx.lineWidth = 1.2
    ctx.setLineDash([5, 4])
    roundRect(ctx, x + 7, y + 7, w - 14, h - 14, 7)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = rgba(INK, 0.12)
    ctx.beginPath()
    ctx.ellipse(x + w * 0.62, y + h * 0.7, w * 0.12, h * 0.08, -0.3, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  private drawLampGlow(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y } = L.lamp
    const heat = 0.42 + this.fee * 0.48 + this.flicker
    const r = L.lamp.s * (6.2 + this.fee * 2.4)
    const g = ctx.createRadialGradient(x, y + 20, 8, x, y + 40, r)
    g.addColorStop(0, rgba(PALETTE.amber, 0.42 * heat))
    g.addColorStop(0.35, rgba(PALETTE.amber, 0.16 * heat))
    g.addColorStop(1, rgba(PALETTE.amber, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, L.w, L.h)
  }

  private drawKey(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y, s } = L.key
    const down = this.frozen ? 1 : this.arm * 0.35
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.15)
    roundRect(ctx, -s * 0.85, -s * 0.12, s * 1.7, s * 0.55, 4)
    ctx.fill()
    ctx.fillStyle = rgba(PALETTE.brass, 0.8)
    ctx.fillRect(-s * 0.7, s * 0.02, s * 0.22, s * 0.16)
    ctx.fillRect(s * 0.48, s * 0.02, s * 0.22, s * 0.16)

    ctx.save()
    ctx.translate(-s * 0.15, s * 0.08 + down * s * 0.12)
    ctx.rotate(-0.12 + down * 0.16)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.15)
    ctx.fillRect(-s * 0.05, -s * 0.08, s * 1.05, s * 0.1)
    ctx.beginPath()
    ctx.arc(s * 0.95, -s * 0.04, s * 0.14, 0, Math.PI * 2)
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.amber, 0.2)
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = rgba(PALETTE.brass, 0.45)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(s * 0.55, s * 0.1)
    ctx.quadraticCurveTo(s * 1.4, -s * 0.8, L.sounder.x - x, L.sounder.y - y + s * 0.2)
    ctx.stroke()
    ctx.restore()
  }

  private drawSounder(ctx: CanvasRenderingContext2D, L: Layout, now: number) {
    const { x, y, s } = L.sounder
    ctx.save()
    ctx.translate(x, y)

    ctx.fillStyle = rgba(PALETTE.pitch, 0.35)
    ctx.beginPath()
    ctx.ellipse(0, s * 0.72, s * 1.15, s * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()

    roundRect(ctx, -s * 1.05, s * 0.18, s * 2.1, s * 0.42, 5)
    const base = ctx.createLinearGradient(-s, s * 0.18, s, s * 0.6)
    base.addColorStop(0, mix(PALETTE.brass, PALETTE.oak, 0.25))
    base.addColorStop(0.5, PALETTE.brass)
    base.addColorStop(1, mix(PALETTE.brass, PALETTE.pitch, 0.2))
    ctx.fillStyle = base
    ctx.fill()

    ctx.fillStyle = rgba(PALETTE.pitch, 0.25)
    ctx.fillRect(-s * 0.92, s * 0.28, s * 1.84, 2)

    this.coil(ctx, -s * 0.38, s * 0.05, s * 0.28, s * 0.42)
    this.coil(ctx, s * 0.38, s * 0.05, s * 0.28, s * 0.42)

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.2)
    ctx.fillRect(-s * 0.08, -s * 0.12, s * 0.16, s * 0.28)
    ctx.fillRect(-s * 0.7, s * 0.32, s * 0.18, s * 0.1)

    const drop = this.arm
    ctx.save()
    ctx.translate(-s * 0.02, -s * 0.02)
    ctx.rotate(-0.18 + drop * 0.28)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.amber, 0.12)
    ctx.fillRect(-s * 0.95, -s * 0.07, s * 1.85, s * 0.13)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.35)
    ctx.fillRect(-s * 0.95, -s * 0.07, s * 1.85, 2)
    ctx.beginPath()
    ctx.arc(s * 0.82, 0, s * 0.09, 0, Math.PI * 2)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.pitch, 0.15)
    ctx.fill()
    ctx.restore()

    if (this.frozen) {
      ctx.fillStyle = rgba(PALETTE.amber, 0.85)
      ctx.beginPath()
      ctx.arc(s * 0.92, s * 0.02, s * 0.08, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = rgba(INK, 0.7)
    ctx.font = `${Math.max(8, s * 0.16)}px "IM Fell English SC", "Iowan Old Style", serif`
    ctx.textAlign = 'center'
    ctx.fillText(this.degraded ? 'WIRE LOOSE' : this.live ? 'NIGHT WIRE' : 'WAIT WIRE', 0, s * 0.48)

    const ozone = this.fee * (0.12 + Math.abs(Math.sin(now * 0.004)) * 0.08)
    if (ozone > 0.02 && !this.reduced) {
      ctx.fillStyle = rgba(PALETTE.amber, ozone)
      ctx.beginPath()
      ctx.ellipse(0, -s * 0.05, s * 0.85, s * 0.22, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private coil(ctx: CanvasRenderingContext2D, x: number, y: number, rw: number, rh: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.3)
    ctx.fillRect(-rw * 0.22, rh * 0.15, rw * 0.44, rh * 0.7)
    for (let i = 0; i < 9; i++) {
      const t = i / 8
      ctx.beginPath()
      ctx.ellipse(0, rh * 0.2 + t * rh * 0.55, rw, rh * 0.11, 0, 0, Math.PI * 2)
      ctx.strokeStyle = mix(PALETTE.brass, PALETTE.oak, 0.15 + t * 0.2)
      ctx.lineWidth = 2.1
      ctx.stroke()
    }
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.15)
    ctx.beginPath()
    ctx.ellipse(0, rh * 0.18, rw * 0.55, rh * 0.08, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawTape(ctx: CanvasRenderingContext2D, L: Layout) {
    const { reel, inker, tapeY, tapeH, blot } = L
    const endX = blot.x + blot.w - 18
    const startX = reel.x
    const paper = mix(PALETTE.ivory, PALETTE.amber, 0.08 + this.fee * 0.06)

    ctx.save()
    ctx.fillStyle = rgba(PALETTE.pitch, 0.28)
    ctx.fillRect(startX, tapeY + 4, endX - startX, tapeH)

    ctx.beginPath()
    ctx.moveTo(startX, tapeY)
    ctx.quadraticCurveTo((startX + endX) / 2, tapeY + 6 + this.fee * 4, endX, tapeY + 3)
    ctx.lineTo(endX, tapeY + tapeH + 3)
    ctx.quadraticCurveTo((startX + endX) / 2, tapeY + tapeH + 8, startX, tapeY + tapeH)
    ctx.closePath()
    ctx.fillStyle = paper
    ctx.fill()
    ctx.strokeStyle = rgba(INK, 0.18)
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.save()
    ctx.beginPath()
    ctx.rect(startX + 8, tapeY - 2, endX - startX - 6, tapeH + 10)
    ctx.clip()

    const spacing = lerp(118, 78, this.fee)
    for (const line of this.lines) {
      const x = inker.x + 8 + (this.scroll - line.tick - 1) * spacing
      if (x > endX + 20 || x < startX - 10) continue
      this.drawLine(ctx, x, tapeY, tapeH, spacing - 8, line)
    }
    ctx.restore()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.1)
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = mix(PALETTE.brass, PALETTE.ivory, 0.25)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r * 0.72, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.2)
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r * 0.18, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.pitch, 0.1)
    roundRect(ctx, inker.x - 10, inker.y - tapeH * 0.7, 22, tapeH * 1.15, 3)
    ctx.fill()
    ctx.fillStyle = rgba(INK, 0.55 + this.arm * 0.3)
    ctx.fillRect(inker.x - 6, tapeY + 4, 12, 3)

    ctx.restore()
  }

  private drawLine(
    ctx: CanvasRenderingContext2D,
    x: number,
    tapeY: number,
    tapeH: number,
    width: number,
    line: Line,
  ) {
    const ink = familyColor(line.family)
    ctx.save()
    if (line.torn) {
      ctx.beginPath()
      ctx.moveTo(x, tapeY + 2)
      ctx.lineTo(x + width * 0.35, tapeY + 2)
      ctx.lineTo(x + width * 0.42, tapeY + tapeH * 0.45)
      ctx.lineTo(x + width * 0.55, tapeY + 4)
      ctx.lineTo(x + width, tapeY + 2)
      ctx.lineTo(x + width, tapeY + tapeH - 2)
      ctx.lineTo(x, tapeY + tapeH - 2)
      ctx.closePath()
      ctx.globalAlpha = 0.55
      ctx.fillStyle = mix(PALETTE.ivory, INK, 0.12)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    if (line.smudge > 0.2) {
      ctx.fillStyle = rgba(INK, line.smudge * 0.35)
      ctx.beginPath()
      ctx.ellipse(x + width * 0.45, tapeY + tapeH * 0.55, width * 0.28, tapeH * 0.22, 0.2, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = ink
    ctx.font = `bold ${Math.max(8, tapeH * 0.28)}px "Cutive Mono", ui-monospace, monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const label = `${familyLabel(line.family).slice(0, 3).toUpperCase()} ${line.short}`
    ctx.globalAlpha = line.failed ? 0.55 : 0.92
    ctx.fillText(label, x + 6, tapeY + tapeH * 0.38)

    this.drawMorseMarks(ctx, x + 6, tapeY + tapeH * 0.72, line.morse, ink, line.failed)
    ctx.restore()
  }

  private drawMorseMarks(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    morse: string,
    ink: string,
    failed: boolean,
  ) {
    let px = x
    ctx.fillStyle = rgba(ink, failed ? 0.5 : 0.9)
    for (const ch of morse) {
      if (ch === '·') {
        ctx.beginPath()
        ctx.arc(px + 2, y, 1.7, 0, Math.PI * 2)
        ctx.fill()
        px += 7
      } else if (ch === '−') {
        ctx.fillRect(px, y - 1.4, 9, 2.6)
        px += 13
      } else if (ch === ' ') {
        px += 6
      } else {
        ctx.font = '9px "Cutive Mono", ui-monospace, monospace'
        ctx.fillText(ch, px, y + 1)
        px += 8
      }
    }
  }

  private drawLamp(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y, s } = L.lamp
    const heat = 0.5 + this.fee * 0.45 + this.flicker
    ctx.save()
    ctx.translate(x, y)

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.2)
    ctx.beginPath()
    ctx.moveTo(-s * 0.42, s * 1.05)
    ctx.lineTo(s * 0.42, s * 1.05)
    ctx.lineTo(s * 0.28, s * 1.35)
    ctx.lineTo(-s * 0.28, s * 1.35)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.amber, 0.15)
    ctx.fillRect(-s * 0.34, s * 0.92, s * 0.68, s * 0.14)

    ctx.fillStyle = rgba(PALETTE.ivory, 0.14 + heat * 0.12)
    ctx.beginPath()
    ctx.moveTo(-s * 0.18, s * 0.92)
    ctx.quadraticCurveTo(-s * 0.32, s * 0.35, -s * 0.14, 0)
    ctx.lineTo(s * 0.14, 0)
    ctx.quadraticCurveTo(s * 0.32, s * 0.35, s * 0.18, s * 0.92)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = rgba(PALETTE.ivory, 0.28)
    ctx.stroke()

    ctx.fillStyle = rgba(PALETTE.amber, 0.35 + heat * 0.45)
    ctx.beginPath()
    ctx.ellipse(0, s * 0.55, s * 0.09, s * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = rgba(PALETTE.ivory, 0.55 + heat * 0.3)
    ctx.beginPath()
    ctx.ellipse(0, s * 0.5, s * 0.04, s * 0.12, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.2)
    ctx.fillRect(-s * 0.2, -s * 0.06, s * 0.4, s * 0.08)
    ctx.restore()
  }

  private drawSparks(ctx: CanvasRenderingContext2D, L: Layout) {
    if (!this.sparks.length) return
    ctx.save()
    ctx.translate(L.sounder.x, L.sounder.y - L.sounder.s * 0.1)
    for (const s of this.sparks) {
      const a = Math.max(0, s.life / s.max)
      ctx.strokeStyle = rgba(PALETTE.amber, a)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x - s.vx * 0.04, s.y - s.vy * 0.04)
      ctx.stroke()
      ctx.fillStyle = rgba(PALETTE.ivory, a)
      ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6)
    }
    ctx.restore()
  }

  private drawVignette(ctx: CanvasRenderingContext2D, L: Layout) {
    const g = ctx.createRadialGradient(L.w * 0.55, L.h * 0.42, L.h * 0.15, L.w * 0.5, L.h * 0.5, L.w * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(8,10,8,0.55)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, L.w, L.h)

    if (this.frozen) {
      ctx.fillStyle = rgba(PALETTE.pitch, 0.12)
      ctx.fillRect(0, 0, L.w, L.h)
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
