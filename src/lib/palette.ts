/** Named night-desk palette — six dyes, no extras. */
export const PALETTE = {
  pitch: '#121610',
  oak: '#5C3A22',
  baize: '#234033',
  brass: '#B08A42',
  amber: '#E6A23C',
  ivory: '#E8D5B0',
} as const

export type PaletteName = keyof typeof PALETTE

/** RAY is amber cooled toward oak — not a seventh brand color. */
export const RAY_EMBER = '#C47A30'
/** Stake is baize lifted toward ivory. */
export const STAKE_LEAF = '#4A6A52'
/** Unknown is ivory dimmed into pitch. */
export const UNKNOWN_ASH = '#6E6450'
/** Lamp-black ink, pitch with a drop of oak. */
export const INK = '#1A1610'

export const FAMILY_TINT: Record<string, string> = {
  SYS: INK,
  JUP: PALETTE.brass,
  RAY: RAY_EMBER,
  TKN: PALETTE.oak,
  STK: STAKE_LEAF,
  '???': UNKNOWN_ASH,
}
