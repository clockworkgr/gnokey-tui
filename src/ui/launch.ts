// Launch-time arguments that select an "acting account" — the address/account
// the TUI acts as when building transactions and CLI commands (e.g. for an
// airgapped signer). Stored in a module so it survives Ink unmount/remount.
export interface ActingArgs {
  /** A bech32 address to act as (need not be in the keybase). */
  address?: string;
  /** A keybase key name to act as (resolved to its address). */
  account?: string;
}

let args: ActingArgs = {};

export const launch = {
  set(a: ActingArgs) {
    args = a;
  },
  get(): ActingArgs {
    return args;
  },
};

/** Parse `--address`/`-a` and `--account` (space- or =-separated) from argv. */
export function parseActingArgs(argv: string[]): ActingArgs {
  const out: ActingArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--address' || a === '-a') out.address = argv[++i];
    else if (a.startsWith('--address=')) out.address = a.slice('--address='.length);
    else if (a.startsWith('-a=')) out.address = a.slice('-a='.length);
    else if (a === '--account') out.account = argv[++i];
    else if (a.startsWith('--account=')) out.account = a.slice('--account='.length);
  }
  return out;
}
