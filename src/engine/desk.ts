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
    const chrome = narrow ? Math.min(236, h * 0.3) : 8
    const deskY = h * (narrow ? 0.28 : 0.24)
    const workH = Math.max(180, h - deskY - chrome)
    const blotW = w * (narrow ? 0.9 : 0.74)
    const blotH = Math.min(workH * 0.78, h * (narrow ? 0.36 : 0.4))
    const blotX = (w - blotW) / 2
    const blotY = deskY + (narrow ? 22 : 36)
    const s = Math.min(w, h) * (narrow ? 0.16 : 0.168)
    const sounderX = blotX + s * (narrow ? 1.35 : 1.45)
    const sounderY = blotY + blotH * (narrow ? 0.36 : 0.5)
    const reelX = narrow ? blotX + s * 0.72 : sounderX + s * 1.72
    const reelY = narrow ? blotY + blotH * 0.74 : sounderY - s * 0.05
    return {
      w,
      h,
      deskY,
      blot: { x: blotX, y: blotY, w: blotW, h: blotH },
      sounder: { x: sounderX, y: sounderY, s },
      reel: { x: reelX, y: reelY, r: s * (narrow ? 0.4 : 0.48) },
      inker: { x: reelX + s * (narrow ? 0.7 : 0.9), y: reelY + s * 0.06 },
      lamp: {
        x: blotX + blotW * (narrow ? 0.82 : 0.9),
        y: deskY - s * (narrow ? 0.05 : 0.15),
        s: s * (narrow ? 1.05 : 1.25),
      },
      key: {
        x: sounderX + (narrow ? s * 1.55 : -s * 0.1),
        y: sounderY + (narrow ? s * 0.15 : s * 1.28),
        s: s * (narrow ? 0.82 : 0.95),
      },
      tapeY: reelY - s * 0.08,
      tapeH: s * (narrow ? 0.46 : 0.5),
    }
  }

  private drawRoom(ctx: CanvasRenderingContext2D, L: Layout) {
    const { w, h, deskY } = L
    const g = ctx.createLinearGradient(0, 0, 0, deskY)
    g.addColorStop(0, '#070806')
    g.addColorStop(1, PALETTE.pitch)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    const rail = 28
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.42)
    ctx.fillRect(0, deskY - rail, w, rail)
    const grain = mulberry32(11)
    ctx.strokeStyle = rgba(PALETTE.oak, 0.35)
    ctx.lineWidth = 1.2
    for (let i = 0; i < 18; i++) {
      const y = deskY - rail + 2 + i * 1.45
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x < w; x += 26) ctx.lineTo(x, y + (grain() - 0.5) * 1.8)
      ctx.stroke()
    }
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.35)
    ctx.fillRect(0, deskY - 4, w, 4)
  }

  private drawDesk(ctx: CanvasRenderingContext2D, L: Layout) {
    const { w, h, deskY } = L
    const top = ctx.createLinearGradient(0, deskY, 0, h)
    top.addColorStop(0, mix(PALETTE.oak, PALETTE.amber, 0.22))
    top.addColorStop(0.12, mix(PALETTE.oak, PALETTE.amber, 0.08))
    top.addColorStop(0.55, PALETTE.oak)
    top.addColorStop(1, mix(PALETTE.oak, PALETTE.pitch, 0.38))
    ctx.fillStyle = top
    ctx.fillRect(0, deskY, w, h - deskY)

    const rng = mulberry32(42)
    for (let i = 0; i < 48; i++) {
      const y = deskY + 10 + rng() * (h - deskY - 12)
      ctx.strokeStyle = rgba(PALETTE.pitch, 0.16 + rng() * 0.16)
      ctx.lineWidth = 1 + rng()
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x < w; x += 36) ctx.lineTo(x, y + (rng() - 0.5) * 4)
      ctx.stroke()
    }

    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.55)
    ctx.fillRect(0, h - 22, w, 22)
    ctx.fillStyle = rgba(PALETTE.pitch, 0.4)
    ctx.fillRect(0, deskY, w, 5)
  }

  private drawBlotter(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y, w, h } = L.blot
    ctx.save()
    ctx.fillStyle = rgba(PALETTE.pitch, 0.28)
    roundRect(ctx, x + 8, y + 10, w, h, 14)
    ctx.fill()

    roundRect(ctx, x, y, w, h, 14)
    const felt = ctx.createLinearGradient(x, y, x + w * 0.15, y + h)
    felt.addColorStop(0, mix(PALETTE.baize, PALETTE.amber, 0.16))
    felt.addColorStop(0.4, mix(PALETTE.baize, PALETTE.ivory, 0.06))
    felt.addColorStop(1, mix(PALETTE.baize, PALETTE.pitch, 0.22))
    ctx.fillStyle = felt
    ctx.fill()

    const rng = mulberry32(99)
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = rng() > 0.55 ? rgba(PALETTE.ivory, 0.07) : rgba(PALETTE.pitch, 0.1)
      ctx.fillRect(x + rng() * w, y + rng() * h, 1.6, 1.6)
    }

    ctx.strokeStyle = rgba(PALETTE.brass, 0.45)
    ctx.lineWidth = 1.4
    ctx.setLineDash([6, 5])
    roundRect(ctx, x + 9, y + 9, w - 18, h - 18, 9)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = rgba(INK, 0.16)
    ctx.beginPath()
    ctx.ellipse(x + w * 0.68, y + h * 0.72, w * 0.1, h * 0.07, -0.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawLampGlow(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y, s } = L.lamp
    const heat = 0.5 + this.fee * 0.5 + this.flicker
    const r = s * (7.4 + this.fee * 3.2)
    const g = ctx.createRadialGradient(x, y + s * 0.7, 6, x - s * 0.4, y + s * 1.4, r)
    g.addColorStop(0, rgba(PALETTE.amber, 0.55 * heat))
    g.addColorStop(0.28, rgba(PALETTE.amber, 0.22 * heat))
    g.addColorStop(1, rgba(PALETTE.amber, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, L.w, L.h)
  }

  private drawKey(ctx: CanvasRenderingContext2D, L: Layout) {
    const { x, y, s } = L.key
    const down = this.frozen ? 1 : this.arm * 0.4
    ctx.save()
    ctx.translate(x, y)

    ctx.fillStyle = rgba(PALETTE.pitch, 0.3)
    ctx.beginPath()
    ctx.ellipse(0, s * 0.42, s * 1.05, s * 0.2, 0, 0, Math.PI * 2)
    ctx.fill()

    roundRect(ctx, -s * 1.05, -s * 0.08, s * 2.1, s * 0.62, 6)
    const wood = ctx.createLinearGradient(0, -s * 0.08, 0, s * 0.5)
    wood.addColorStop(0, mix(PALETTE.oak, PALETTE.amber, 0.18))
    wood.addColorStop(1, mix(PALETTE.oak, PALETTE.pitch, 0.2))
    ctx.fillStyle = wood
    ctx.fill()
    ctx.strokeStyle = rgba(PALETTE.pitch, 0.35)
    ctx.stroke()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.12)
    ctx.fillRect(-s * 0.82, s * 0.12, s * 0.28, s * 0.18)
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.28, s * 0.18)

    ctx.save()
    ctx.translate(-s * 0.28, s * 0.12 + down * s * 0.14)
    ctx.rotate(-0.18 + down * 0.22)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.amber, 0.12)
    roundRect(ctx, -s * 0.08, -s * 0.1, s * 1.35, s * 0.16, 3)
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.35)
    ctx.fillRect(-s * 0.08, -s * 0.1, s * 1.35, 2)
    ctx.beginPath()
    ctx.arc(s * 1.2, -s * 0.02, s * 0.18, 0, Math.PI * 2)
    ctx.fillStyle = mix(PALETTE.pitch, PALETTE.oak, 0.15)
    ctx.fill()
    ctx.strokeStyle = rgba(PALETTE.brass, 0.5)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()

    ctx.strokeStyle = rgba(PALETTE.brass, 0.55)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(s * 0.55, s * 0.18)
    ctx.quadraticCurveTo(s * 1.6, -s * 0.55, L.sounder.x - x + s * 0.2, L.sounder.y - y + s * 0.15)
    ctx.stroke()
    ctx.restore()
  }

  private drawSounder(ctx: CanvasRenderingContext2D, L: Layout, now: number) {
    const { x, y, s } = L.sounder
    ctx.save()
    ctx.translate(x, y)

    ctx.fillStyle = rgba(PALETTE.pitch, 0.4)
    ctx.beginPath()
    ctx.ellipse(s * 0.08, s * 0.95, s * 1.45, s * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()

    const boxW = s * 2.35
    const boxH = s * 0.72
    const boxX = -boxW * 0.5
    const boxY = s * 0.22
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.12)
    ctx.beginPath()
    ctx.moveTo(boxX + 8, boxY + boxH)
    ctx.lineTo(boxX + boxW + 10, boxY + boxH - 8)
    ctx.lineTo(boxX + boxW + 10, boxY - 6)
    ctx.lineTo(boxX + 8, boxY)
    ctx.closePath()
    ctx.fill()

    roundRect(ctx, boxX, boxY, boxW, boxH, 5)
    const wood = ctx.createLinearGradient(boxX, boxY, boxX, boxY + boxH)
    wood.addColorStop(0, mix(PALETTE.oak, PALETTE.amber, 0.2))
    wood.addColorStop(0.45, PALETTE.oak)
    wood.addColorStop(1, mix(PALETTE.oak, PALETTE.pitch, 0.25))
    ctx.fillStyle = wood
    ctx.fill()
    ctx.strokeStyle = rgba(PALETTE.pitch, 0.4)
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.15)
    ctx.fillRect(boxX + 6, boxY + 6, 10, boxH - 12)
    ctx.fillRect(boxX + boxW - 16, boxY + 6, 10, boxH - 12)

    ctx.fillStyle = rgba(INK, 0.78)
    ctx.font = `${Math.max(10, s * 0.17)}px "IM Fell English SC", "Iowan Old Style", serif`
    ctx.textAlign = 'center'
    ctx.fillText(this.degraded ? 'WIRE LOOSE' : this.live ? 'NIGHT WIRE' : 'WAIT WIRE', 0, boxY + boxH * 0.62)

    const bed = ctx.createLinearGradient(-s, boxY - s * 0.08, s, boxY + s * 0.12)
    bed.addColorStop(0, mix(PALETTE.brass, PALETTE.oak, 0.28))
    bed.addColorStop(0.5, mix(PALETTE.brass, PALETTE.ivory, 0.12))
    bed.addColorStop(1, mix(PALETTE.brass, PALETTE.pitch, 0.18))
    ctx.fillStyle = bed
    roundRect(ctx, -s * 1.05, boxY - s * 0.1, s * 2.1, s * 0.2, 3)
    ctx.fill()

    this.coil(ctx, -s * 0.42, -s * 0.42, s * 0.36, s * 0.62)
    this.coil(ctx, s * 0.42, -s * 0.42, s * 0.36, s * 0.62)

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.18)
    ctx.fillRect(-s * 0.1, -s * 0.22, s * 0.2, s * 0.38)
    ctx.fillRect(s * 0.78, boxY - s * 0.22, s * 0.16, s * 0.22)

    const drop = this.arm
    ctx.save()
    ctx.translate(-s * 0.02, -s * 0.18)
    ctx.rotate(-0.28 + drop * 0.42)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.pitch, 0.08)
    roundRect(ctx, -s * 1.15, -s * 0.1, s * 2.25, s * 0.2, 4)
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.4)
    ctx.fillRect(-s * 1.15, -s * 0.1, s * 2.25, 3)
    ctx.beginPath()
    ctx.arc(s * 1.02, 0, s * 0.13, 0, Math.PI * 2)
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.2)
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.pitch, PALETTE.oak, 0.2)
    ctx.fillRect(s * 0.72, s * 0.02, s * 0.22, s * 0.12)
    ctx.restore()

    if (this.frozen) {
      ctx.fillStyle = rgba(PALETTE.amber, 0.9)
      ctx.beginPath()
      ctx.arc(s * 1.05, -s * 0.28, s * 0.1, 0, Math.PI * 2)
      ctx.fill()
    }

    const ozone = this.fee * (0.14 + Math.abs(Math.sin(now * 0.004)) * 0.1)
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
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.25)
    ctx.fillRect(-rw * 0.2, rh * 0.12, rw * 0.4, rh * 0.78)
    const copper = mix(PALETTE.brass, PALETTE.oak, 0.28)
    for (let i = 0; i < 12; i++) {
      const t = i / 11
      ctx.beginPath()
      ctx.ellipse(0, rh * 0.16 + t * rh * 0.62, rw, rh * 0.09, 0, 0, Math.PI * 2)
      ctx.strokeStyle = mix(copper, PALETTE.pitch, t * 0.18)
      ctx.lineWidth = 2.6
      ctx.stroke()
    }
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.2)
    ctx.beginPath()
    ctx.ellipse(0, rh * 0.14, rw * 0.52, rh * 0.07, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.2)
    ctx.beginPath()
    ctx.ellipse(0, rh * 0.8, rw * 0.52, rh * 0.07, 0, 0, Math.PI * 2)
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

    const spacing = lerp(104, 70, this.fee)
    for (const line of this.lines) {
      const x = inker.x + 8 + (this.scroll - line.tick - 1) * spacing
      if (x > endX + 20 || x < startX - 10) continue
      this.drawLine(ctx, x, tapeY, tapeH, spacing - 8, line)
    }
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(startX + 10, tapeY + 2, endX - startX - 16, 5)
    ctx.clip()
    ctx.fillStyle = rgba(INK, 0.22)
    for (let hx = startX + 14; hx < endX; hx += 9) {
      ctx.beginPath()
      ctx.arc(hx, tapeY + 4.5, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.08)
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = mix(PALETTE.ivory, PALETTE.amber, 0.25)
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r * 0.7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = mix(PALETTE.brass, PALETTE.ivory, 0.3)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r * 0.82, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = mix(PALETTE.oak, PALETTE.pitch, 0.15)
    ctx.beginPath()
    ctx.arc(reel.x, reel.y, reel.r * 0.16, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.pitch, 0.08)
    roundRect(ctx, inker.x - 14, inker.y - tapeH * 0.85, 28, tapeH * 1.35, 4)
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.2)
    ctx.fillRect(inker.x - 14, inker.y - tapeH * 0.85, 28, 4)
    ctx.fillStyle = rgba(INK, 0.6 + this.arm * 0.35)
    ctx.fillRect(inker.x - 8, tapeY + 3, 16, 4)

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
    const heat = 0.55 + this.fee * 0.45 + this.flicker
    ctx.save()
    ctx.translate(x, y)

    ctx.fillStyle = rgba(PALETTE.pitch, 0.35)
    ctx.beginPath()
    ctx.ellipse(0, s * 1.55, s * 0.42, s * 0.12, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.oak, 0.18)
    ctx.beginPath()
    ctx.moveTo(-s * 0.38, s * 1.12)
    ctx.quadraticCurveTo(-s * 0.52, s * 1.38, -s * 0.22, s * 1.52)
    ctx.lineTo(s * 0.22, s * 1.52)
    ctx.quadraticCurveTo(s * 0.52, s * 1.38, s * 0.38, s * 1.12)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = mix(PALETTE.brass, PALETTE.amber, 0.2)
    ctx.fillRect(-s * 0.3, s * 1.02, s * 0.6, s * 0.14)

    ctx.fillStyle = rgba(PALETTE.ivory, 0.1 + heat * 0.16)
    ctx.beginPath()
    ctx.moveTo(-s * 0.16, s * 1.04)
    ctx.quadraticCurveTo(-s * 0.3, s * 0.45, -s * 0.13, s * 0.04)
    ctx.lineTo(s * 0.13, s * 0.04)
    ctx.quadraticCurveTo(s * 0.3, s * 0.45, s * 0.16, s * 1.04)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = rgba(PALETTE.ivory, 0.38)
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.strokeStyle = rgba(PALETTE.ivory, 0.2)
    ctx.beginPath()
    ctx.moveTo(-s * 0.08, s * 0.12)
    ctx.quadraticCurveTo(-s * 0.18, s * 0.5, -s * 0.1, s * 0.96)
    ctx.stroke()

    ctx.fillStyle = rgba(PALETTE.amber, 0.4 + heat * 0.5)
    ctx.beginPath()
    ctx.ellipse(0, s * 0.62, s * 0.1 * (1 + this.fee * 0.3), s * 0.26 * (1 + this.fee * 0.25), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = rgba(PALETTE.ivory, 0.6 + heat * 0.3)
    ctx.beginPath()
    ctx.ellipse(0, s * 0.56, s * 0.045, s * 0.14, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = mix(PALETTE.brass, PALETTE.ivory, 0.22)
    ctx.fillRect(-s * 0.18, -s * 0.02, s * 0.36, s * 0.1)
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
