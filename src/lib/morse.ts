const ALPHA: Record<string, string> = {
  A: '·−',
  B: '−···',
  C: '−·−·',
  D: '−··',
  E: '·',
  F: '··−·',
  G: '−−·',
  H: '····',
  I: '··',
  J: '·−−−',
  K: '−·−',
  L: '·−··',
  M: '−−',
  N: '−·',
  O: '−−−',
  P: '·−−·',
  Q: '−−·−',
  R: '·−·',
  S: '···',
  T: '−',
  U: '··−',
  V: '···−',
  W: '·−−',
  X: '−··−',
  Y: '−·−−',
  Z: '−−··',
  '0': '−−−−−',
  '1': '·−−−−',
  '2': '··−−−',
  '3': '···−−',
  '4': '····−',
  '5': '·····',
  '6': '−····',
  '7': '−−···',
  '8': '−−−··',
  '9': '−−−−·',
}

export function charMorse(ch: string): string {
  return ALPHA[ch.toUpperCase()] ?? '··'
}

export function stampMorse(sig: string): string {
  const a = charMorse(sig[0] ?? 'E')
  const b = charMorse(sig[1] ?? 'T')
  return `${a} ${b}`
}

export function garbleMorse(morse: string, seed: number): string {
  const glyphs = ['·', '−', '?', '×', '·']
  return morse
    .split('')
    .map((ch, i) => {
      if (ch === ' ') return ' '
      const n = (seed + i * 17) % 5
      if (n === 0) return glyphs[(seed + i) % glyphs.length]!
      if (n === 1) return `${ch}?`
      return ch
    })
    .join('')
}
