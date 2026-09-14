// Typed command builders over the gnokey binary.
//
// Every function returns a `Cmd` descriptor (args + optional stdin) so the UI
// can show a preview of the exact `gnokey ...` invocation before running it,
// then execute it with `run()`. Passwords and mnemonics are passed via stdin,
// never argv, so a descriptor's args are always safe to display verbatim.
import type { Settings } from '../config.ts';
import { runGnokey } from './exec.ts';
import {
  isErrorOutput,
  parseAccount,
  parseError,
  parseGasPrice,
  parseKeyList,
  parseQuery,
  parseStorage,
  parseTxMetrics,
} from './parse.ts';
import type {
  AccountInfo,
  GasPrice,
  KeyInfo,
  QueryResult,
  RunResult,
  TxMetrics,
} from './types.ts';

export interface Cmd {
  args: string[];
  stdinLines?: string[];
  /** When true, stdin held secrets; irrelevant to display but documents intent. */
  redactStdin?: boolean;
  timeoutMs?: number;
}

/** Quote a single argument for a copy-pasteable command line. */
function shellArg(a: string): string {
  return /[\s"']/.test(a) ? JSON.stringify(a) : a;
}

/** Render a descriptor as a copy-pasteable command line (secrets are in stdin). */
export function previewCmd(bin: string, cmd: Cmd): string {
  return `${bin} ${cmd.args.map(shellArg).join(' ')}`;
}

/**
 * The two gnokey commands an airgapped signer needs for an unsigned tx file:
 * `sign` (run on the offline machine that holds the key) and `broadcast` (run
 * on this online machine). The chain ID, account number, and sequence are baked
 * into the signature, so they must match what this tool queried.
 */
export function airgapCommands(
  s: Settings,
  o: { txFile: string; keyName: string; accountNumber: string; accountSequence: string },
): { sign: string; broadcast: string } {
  const home = s.home && s.home.trim() ? ` -home ${shellArg(s.home)}` : '';
  const file = shellArg(o.txFile);
  const sign =
    `gnokey sign -tx-path ${file} -chainid ${s.chainId} ` +
    `-account-number ${o.accountNumber} -account-sequence ${o.accountSequence}` +
    `${home} ${o.keyName}`;
  const broadcast = `gnokey broadcast${home} -remote ${s.remote} ${file}`;
  return { sign, broadcast };
}

export async function run(bin: string, cmd: Cmd): Promise<RunResult> {
  return runGnokey(bin, cmd.args, {
    stdinLines: cmd.stdinLines,
    timeoutMs: cmd.timeoutMs,
  });
}

/**
 * Return a copy of a command with its password authentication removed: the
 * -insecure-password-stdin flag and any stdin lines are dropped. Used for the
 * 'prompt' strategy (gnokey prompts on the TTY) and the 'keychain' strategy
 * (gnokeykc supplies the password), where no password flows through this tool.
 */
export function stripAuth(cmd: Cmd): Cmd {
  return {
    ...cmd,
    args: cmd.args.filter((a) => a !== '-insecure-password-stdin'),
    stdinLines: undefined,
    redactStdin: false,
  };
}

// Global flags valid on any command. Included everywhere; harmless on the
// local-only commands that ignore -remote.
function globals(s: Settings): string[] {
  const g: string[] = [];
  if (s.home && s.home.trim()) g.push('-home', s.home);
  if (s.remote && s.remote.trim()) g.push('-remote', s.remote);
  return g;
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

export function listKeysCmd(s: Settings): Cmd {
  return { args: ['list', ...globals(s)] };
}

export async function listKeys(s: Settings): Promise<KeyInfo[]> {
  const res = await run(s.bin, listKeysCmd(s));
  if (isErrorOutput(res.code, res.stderr)) {
    throw new Error(parseError(res.stderr, res.stdout));
  }
  return parseKeyList(res.stdout);
}

export function generateMnemonicCmd(_s: Settings): Cmd {
  return { args: ['generate'] };
}

export interface AddKeyOpts {
  name: string;
  /** 'new' generates a mnemonic; 'recover' takes an existing one. */
  mode: 'new' | 'recover';
  password: string;
  mnemonic?: string;
  nobackup?: boolean;
  account?: number;
  index?: number;
  /** Overwrite an existing key without prompting. */
  force?: boolean;
}

export function addKeyCmd(s: Settings, o: AddKeyOpts): Cmd {
  const args = ['add', '-insecure-password-stdin'];
  if (o.mode === 'recover') args.push('-recover');
  if (o.nobackup) args.push('-nobackup');
  if (o.force) args.push('-force');
  if (o.account) args.push('-account', String(o.account));
  if (o.index) args.push('-index', String(o.index));
  args.push(...globals(s), o.name);

  const stdin: string[] =
    o.mode === 'recover'
      ? [o.mnemonic ?? '', o.password, o.password]
      : [o.password, o.password];

  return { args, stdinLines: stdin, redactStdin: true };
}

export interface DeleteKeyOpts {
  name: string;
  /** For local keys: the decrypt password. Ignored for offline/ledger. */
  password?: string;
  /** True for offline/ledger keys (public-key references). */
  reference?: boolean;
}

export function deleteKeyCmd(s: Settings, o: DeleteKeyOpts): Cmd {
  if (o.reference) {
    return { args: ['delete', '-yes', ...globals(s), o.name] };
  }
  return {
    args: ['delete', '-insecure-password-stdin', ...globals(s), o.name],
    stdinLines: [o.password ?? ''],
    redactStdin: true,
  };
}

export function exportKeyCmd(
  s: Settings,
  o: { name: string; outputPath: string; decryptPass: string; armorPass: string },
): Cmd {
  return {
    args: [
      'export',
      '-insecure-password-stdin',
      '-key',
      o.name,
      '-output-path',
      o.outputPath,
      ...globals(s),
    ],
    stdinLines: [o.decryptPass, o.armorPass, o.armorPass],
    redactStdin: true,
  };
}

export function importKeyCmd(
  s: Settings,
  o: { name: string; armorPath: string; armorPass: string; encryptPass: string },
): Cmd {
  return {
    args: [
      'import',
      '-insecure-password-stdin',
      '-name',
      o.name,
      '-armor-path',
      o.armorPath,
      ...globals(s),
    ],
    stdinLines: [o.armorPass, o.encryptPass, o.encryptPass],
    redactStdin: true,
  };
}

// ---------------------------------------------------------------------------
// Queries (read-only, gas-free)
// ---------------------------------------------------------------------------

export function queryCmd(
  s: Settings,
  path: string,
  opts: { data?: string; height?: number } = {},
): Cmd {
  const args = ['query'];
  if (opts.data !== undefined && opts.data !== '') args.push('-data', opts.data);
  if (opts.height) args.push('-height', String(opts.height));
  args.push(...globals(s), path);
  return { args };
}

export async function query(
  s: Settings,
  path: string,
  opts: { data?: string; height?: number } = {},
): Promise<QueryResult> {
  const res = await run(s.bin, queryCmd(s, path, opts));
  if (isErrorOutput(res.code, res.stderr)) {
    throw new Error(parseError(res.stderr, res.stdout));
  }
  return parseQuery(res.stdout);
}

export async function getGasPrice(s: Settings): Promise<GasPrice | null> {
  const q = await query(s, 'auth/gasprice');
  return parseGasPrice(q.data);
}

export async function getAccount(
  s: Settings,
  address: string,
): Promise<AccountInfo | null> {
  const q = await query(s, `auth/accounts/${address}`);
  return parseAccount(q.data);
}

export async function getBalance(s: Settings, address: string): Promise<string> {
  const q = await query(s, `bank/balances/${address}`);
  // data is a quoted string like "9969353159ugnot"
  const trimmed = q.data.trim();
  return trimmed.replace(/^"|"$/g, '');
}

export async function getStorage(s: Settings, pkgPath: string) {
  const q = await query(s, 'vm/qstorage', { data: pkgPath });
  return parseStorage(q.data);
}

// ---------------------------------------------------------------------------
// Transactions (maketx)
// ---------------------------------------------------------------------------

export type TxKind = 'send' | 'call' | 'run' | 'addpkg';
export type TxMode = 'only' | 'test' | 'unsigned';

export interface TxSpec {
  kind: TxKind;
  key: string;
  /** Subcommand-specific flags, e.g. ['-send', '100ugnot', '-to', 'g1...']. */
  fields: string[];
  gasWanted: string;
  gasFee: string;
  memo?: string;
  /** Extra positional after the key name (run's source path). */
  extraPositional?: string;
  /**
   * Set the tx caller to this address without a keybase entry, for building an
   * unsigned tx on behalf of a watch-only / airgapped account. Only applied in
   * 'unsigned' mode (gnokey's -master accepts a bare bech32 there); never used
   * for a real broadcast, which would take the session-signing path.
   */
  master?: string;
}

/**
 * Build the maketx command for a given mode:
 *  - 'only'     dry run: sign + simulate, estimate gas, do not broadcast
 *  - 'test'     simulate then broadcast (the normal path)
 *  - 'unsigned' emit the unsigned tx JSON, no password, no network
 */
export function txCmd(s: Settings, spec: TxSpec, mode: TxMode): Cmd {
  const args = ['maketx', spec.kind, ...spec.fields];
  args.push('-gas-wanted', spec.gasWanted, '-gas-fee', spec.gasFee);
  if (spec.memo) args.push('-memo', spec.memo);
  args.push('-chainid', s.chainId);

  if (mode === 'unsigned') {
    if (spec.master) args.push('-master', spec.master);
    args.push('-broadcast=false');
  } else {
    args.push('-broadcast=true', '-simulate', mode, '-insecure-password-stdin');
  }

  args.push(...globals(s), spec.key);
  if (spec.extraPositional) args.push(spec.extraPositional);

  const cmd: Cmd = { args, timeoutMs: 120_000 };
  if (mode !== 'unsigned') {
    cmd.stdinLines = [''];
    cmd.redactStdin = true;
  }
  return cmd;
}

export interface TxOutcome {
  ok: boolean;
  metrics: TxMetrics;
  error?: string;
  raw: RunResult;
}

/**
 * Assemble a TxOutcome from a finished run. The strategy-aware dispatch (which
 * binary, whether to pipe the password) lives in authexec.planPwCommand; screens
 * run the resulting (bin, cmd) and pass the result here.
 */
export function txOutcome(res: RunResult): TxOutcome {
  const failed = isErrorOutput(res.code, res.stderr);
  return {
    ok: !failed,
    metrics: parseTxMetrics(res.stdout),
    error: failed ? parseError(res.stderr, res.stdout) : undefined,
    raw: res,
  };
}

// Convenience field builders for each tx kind. -----------------------------

export function sendFields(o: { to: string; amount: string }): string[] {
  return ['-send', o.amount, '-to', o.to];
}

export function callFields(o: {
  pkgPath: string;
  func: string;
  args: string[];
  send?: string;
  maxDeposit?: string;
}): string[] {
  const f = ['-pkgpath', o.pkgPath, '-func', o.func];
  for (const a of o.args) f.push('-args', a);
  if (o.send) f.push('-send', o.send);
  if (o.maxDeposit) f.push('-max-deposit', o.maxDeposit);
  return f;
}

export function addpkgFields(o: {
  pkgPath: string;
  pkgDir: string;
  send?: string;
  maxDeposit?: string;
}): string[] {
  const f = ['-pkgpath', o.pkgPath, '-pkgdir', o.pkgDir];
  if (o.send) f.push('-send', o.send);
  if (o.maxDeposit) f.push('-max-deposit', o.maxDeposit);
  return f;
}

export function runFields(o: { send?: string; maxDeposit?: string }): string[] {
  const f: string[] = [];
  if (o.send) f.push('-send', o.send);
  if (o.maxDeposit) f.push('-max-deposit', o.maxDeposit);
  return f;
}
