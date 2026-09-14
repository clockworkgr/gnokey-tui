// Display helpers: coin amounts, addresses, byte sizes.

/**
 * Format a coin string like "9969353159ugnot" as "9,969.353159 GNOT"
 * with the raw ugnot amount alongside. Non-ugnot or unparseable inputs are
 * returned unchanged.
 */
export function formatCoins(raw: string): string {
  const s = raw.trim();
  if (!s) return '0';
  const m = s.match(/^(\d+)ugnot$/);
  if (!m) return s;
  const ugnot = BigInt(m[1]);
  const whole = ugnot / 1_000_000n;
  const frac = ugnot % 1_000_000n;
  const wholeStr = groupThousands(whole.toString());
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  const gnot = fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
  return `${gnot} GNOT  (${groupThousands(m[1])} ugnot)`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Shorten a bech32 address to g1abcd…wxyz for compact display. */
export function shortAddr(addr: string, head = 8, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Shorten any long token (e.g. a gpub key) for a table cell. */
export function truncate(s: string, max = 24): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** Human-readable byte count. */
export function formatBytes(n: number | string): string {
  const bytes = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(bytes)) return String(n);
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  return `${(kb / 1024).toFixed(2)} MiB`;
}
