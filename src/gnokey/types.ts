// Shared type definitions for the gnokey wrapper layer.

/** The kind of a key as reported by `gnokey list`. */
export type KeyType = 'local' | 'ledger' | 'offline' | 'multi' | string;

/** A single entry parsed out of `gnokey list`. */
export interface KeyInfo {
  index: number;
  name: string;
  type: KeyType;
  address: string;
  /** Raw pubkey field. For multisig keys this is the bracketed list. */
  pubkey: string;
  /** For multisig keys, the individual member pubkeys. */
  pubkeys?: string[];
  /** Derivation path, or undefined when gnokey reports `<nil>`. */
  path?: string;
  /** True for key types that can sign transactions (local, ledger). */
  canSign: boolean;
}

/** Result of spawning the gnokey binary. */
export interface RunResult {
  /** Exit code. -1 when the process was killed (e.g. timeout). */
  code: number;
  stdout: string;
  stderr: string;
  /** The argv (excluding the binary) that was executed, for display. */
  args: string[];
}

/** A `height:` / `data:` pair from a `gnokey query` response. */
export interface QueryResult {
  height: number;
  data: string;
}

/** Parsed `auth/accounts/<addr>` response. */
export interface AccountInfo {
  address: string;
  coins: string;
  publicKey: string | null;
  accountNumber: string;
  sequence: string;
}

/** Parsed `auth/gasprice` response. */
export interface GasPrice {
  gas: string;
  price: string;
}

/** Metrics printed after a (dry-run or real) broadcast. */
export interface TxMetrics {
  /** Result data printed before the `OK!` line (function return, etc.). */
  data?: string;
  ok: boolean;
  gasWanted?: string;
  gasUsed?: string;
  height?: string;
  storageDelta?: string;
  storageFee?: string;
  totalTxCost?: string;
  events?: string;
  info?: string;
  txHash?: string;
  pkgPath?: string;
  /** Extracted from INFO during a dry run, when present. */
  estimatedGas?: string;
  suggestedGas?: string;
  estimatedFee?: string;
}
