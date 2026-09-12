/** Gated sounder click. Mute by default; stay silent if Web Audio fails. */
export class SounderClick {
  enabled = false
  private ctx: AudioContext | null = null

  async unmute(): Promise<boolean> {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return false
      if (!this.ctx) this.ctx = new Ctx()
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      this.enabled = this.ctx.state === 'running'
      return this.enabled
    } catch {
      this.enabled = false
      this.ctx = null
      return false
    }
  }

  mute() {
    this.enabled = false
    void this.ctx?.suspend().catch(() => undefined)
  }

  tick(failed: boolean) {
    if (!this.enabled || !this.ctx) return
    try {
      const ctx = this.ctx
      const now = ctx.currentTime
      this.burst(ctx, now, failed ? 180 : 920, failed ? 0.07 : 0.045, failed ? 0.09 : 0.055)
      if (failed) this.burst(ctx, now + 0.055, 140, 0.05, 0.07)
    } catch {
      this.enabled = false
    }
  }

  private burst(ctx: AudioContext, when: number, hz: number, dur: number, gain: number) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(hz, when)
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, hz * 0.35), when + dur)
    g.gain.setValueAtTime(gain, when)
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(when)
    osc.stop(when + dur + 0.01)
  }
}
