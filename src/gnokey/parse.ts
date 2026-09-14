// Parsers for gnokey's human-oriented text output.
//
// gnokey prints for humans, not machines, so these functions turn its output
// back into structured data. They are deliberately tolerant: gnokey's format
// is stable but not a contract, so unknown lines are ignored rather than
// treated as errors.
import type {
  AccountInfo,
  GasPrice,
  KeyInfo,
  QueryResult,
  TxMetrics,
} from './types.ts';

const SIGNING_TYPES = new Set(['local', 'ledger']);

/** Parse the output of `gnokey list` into structured key entries. */
export function parseKeyList(stdout: string): KeyInfo[] {
  const keys: KeyInfo[] = [];
  const re =
    /^(\d+)\.\s+(.+?)\s+\((\w+)\)\s+-\s+addr:\s+(\S+)\s+pub:\s+(.+),\s+path:\s+(.+)$/;

  for (const line of stdout.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const type = m[3];
    const rawPub = m[5].trim();
    const rawPath = m[6].trim();

    let pubkeys: string[] | undefined;
    if (rawPub.startsWith('[') && rawPub.endsWith(']')) {
      pubkeys = rawPub
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    keys.push({
      index: Number(m[1]),
      name: m[2].trim(),
      type,
      address: m[4].trim(),
      pubkey: rawPub,
      pubkeys,
      path: rawPath === '<nil>' ? undefined : rawPath,
      canSign: SIGNING_TYPES.has(type),
    });
  }
  return keys;
}

/**
 * Split a `gnokey query` response into its height and data. Data may span
 * multiple lines (account JSON, rendered markdown, source files), so
 * everything after the first `data:` marker is treated as the payload.
 */
export function parseQuery(stdout: string): QueryResult {
  const heightMatch = stdout.match(/^height:\s*(\d+)\s*$/m);
  const height = heightMatch ? Number(heightMatch[1]) : 0;

  const marker = stdout.indexOf('data:');
  let data = '';
  if (marker >= 0) {
    data = stdout.slice(marker + 'data:'.length);
    if (data.startsWith(' ')) data = data.slice(1);
    data = data.replace(/\n$/, '');
  } else {
    data = stdout.trim();
  }
  return { height, data };
}

/**
 * Extract a friendly, single-line error message from gnokey's failure output.
 * Handles the boxed `--= Error =--` / `Data:` format, the `Log:` prefix used
 * by failing vm queries, and bare one-line errors like `Key X not found`.
 */
export function parseError(stderr: string, stdout = ''): string {
  const combined = `${stderr}\n${stdout}`;

  const dataMatch = combined.match(/^\s*Data:\s*(.+)$/m);
  if (dataMatch) return cleanErr(dataMatch[1]);

  const logMatch = combined.match(/^\s*Log:\s*(.+)$/m);
  if (logMatch) return cleanErr(logMatch[1]);

  const firstLine = stderr
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('--='));
  if (firstLine) return firstLine;

  return stderr.trim() || 'unknown error';
}

// Strip Go error-struct noise like `&errors.errorString{s:"..."}` down to the
// message, and clip overly long single lines.
function cleanErr(s: string): string {
  let out = s.trim();
  const struct = out.match(/errorString\{s:"([^"]*)"/);
  if (struct) out = struct[1];
  out = out.replace(/\\n/g, ' ').replace(/\s+/g, ' ');
  return out.length > 400 ? out.slice(0, 400) + '…' : out;
}

/** Parse the `{ "gas": "...", "price": "..." }` gasprice payload. */
export function parseGasPrice(data: string): GasPrice | null {
  try {
    const obj = JSON.parse(data);
    return { gas: String(obj.gas), price: String(obj.price) };
  } catch {
    return null;
  }
}

/** Parse the BaseAccount JSON returned by `auth/accounts/<addr>`. */
export function parseAccount(data: string): AccountInfo | null {
  try {
    const obj = JSON.parse(data);
    const base = obj.BaseAccount ?? obj;
    let publicKey: string | null = null;
    if (base.public_key && typeof base.public_key === 'object') {
      publicKey = base.public_key.value ?? JSON.stringify(base.public_key);
    }
    return {
      address: String(base.address ?? ''),
      coins: String(base.coins ?? ''),
      publicKey,
      accountNumber: String(base.account_number ?? '0'),
      sequence: String(base.sequence ?? '0'),
    };
  } catch {
    return null;
  }
}

/** Parse the metrics block printed after a broadcast (real or dry-run). */
export function parseTxMetrics(stdout: string): TxMetrics {
  const lines = stdout.split('\n');
  const okIdx = lines.findIndex((l) => l.trim() === 'OK!');
  const ok = okIdx >= 0;

  // Everything before OK! is result data (may be empty).
  const data = ok ? lines.slice(0, okIdx).join('\n').trim() : undefined;

  const grab = (label: string): string | undefined => {
    const m = stdout.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : undefined;
  };

  const info = grab('INFO');
  const metrics: TxMetrics = {
    data: data || undefined,
    ok,
    gasWanted: grab('GAS WANTED'),
    gasUsed: grab('GAS USED'),
    height: grab('HEIGHT'),
    storageDelta: grab('STORAGE DELTA'),
    storageFee: grab('STORAGE FEE'),
    totalTxCost: grab('TOTAL TX COST'),
    events: grab('EVENTS'),
    info,
    txHash: grab('TX HASH'),
    pkgPath: grab('PKGPATH'),
  };

  if (info) {
    const est = info.match(/estimated gas usage:\s*(\d+)/);
    const sug = info.match(/margin:\s*(\d+)\)/);
    const fee = info.match(/gas fee:\s*([\dA-Za-z/]+)/);
    if (est) metrics.estimatedGas = est[1];
    if (sug) metrics.suggestedGas = sug[1];
    if (fee) metrics.estimatedFee = fee[1];
  }

  return metrics;
}

/** Parse `storage: N, deposit: M` from vm/qstorage. */
export function parseStorage(
  data: string,
): { storage: string; deposit: string } | null {
  const m = data.match(/storage:\s*(\d+),\s*deposit:\s*(\d+)/);
  return m ? { storage: m[1], deposit: m[2] } : null;
}

/** True when gnokey output signals a failure (non-zero code or error block). */
export function isErrorOutput(code: number, stderr: string): boolean {
  return code !== 0 || /--=\s*Error\s*=--/.test(stderr);
}
