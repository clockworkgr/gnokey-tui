// Central color and glyph palette so the UI reads as one system.
//
// gno.land's accent is a green/teal; we lean on it for focus and identity,
// with a warm amber for "this touches the chain / costs gas / needs care" and
// red reserved strictly for failures.

export const color = {
  accent: '#3fb68b', // gno green — primary identity + focus
  accentDim: '#2a6f57',
  amber: '#e0a458', // caution: signing, gas, broadcasts
  red: '#e06c75',
  blue: '#61afef',
  text: 'white',
  dim: 'gray',
  muted: '#8a8a8a',
} as const;

export const glyph = {
  logo: '⬢',
  arrow: '›',
  bullet: '•',
  check: '✔',
  cross: '✖',
  warn: '⚠',
  key: '🔑',
  coin: '◈',
  dot: '·',
} as const;

/** Color a key type badge consistently across screens. */
export function keyTypeColor(type: string): string {
  switch (type) {
    case 'local':
      return color.accent;
    case 'ledger':
      return color.blue;
    case 'multi':
      return color.amber;
    case 'offline':
      return color.muted;
    default:
      return color.dim;
  }
}
