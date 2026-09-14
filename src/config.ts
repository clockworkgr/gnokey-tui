// Network presets and persisted user settings.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Network {
  id: string;
  label: string;
  remote: string;
  chainId: string;
}

/**
 * Known gno.land networks. Mainnet is live at rpc.gno.land with chain-id
 * `gnoland-1` (verified 2026-09-14; from the `chain/mainnet` deployment,
 * misc/deployments/mainnet.gno.land). It is a fresh chain, not a hardfork of the
 * pre-launch betanet (`gnoland1`), and now occupies the rpc.gno.land endpoint —
 * so there is no betanet preset here; that chain-id at this endpoint would be
 * misconfigured. Testnet endpoints are from docs/resources/gnoland-networks.md.
 */
export const NETWORKS: Network[] = [
  {
    id: 'mainnet',
    label: 'Mainnet (rpc.gno.land)',
    remote: 'https://rpc.gno.land:443',
    chainId: 'gnoland-1',
  },
  {
    id: 'staging',
    label: 'Staging (rpc.staging.gno.land)',
    remote: 'https://rpc.staging.gno.land:443',
    chainId: 'staging',
  },
  {
    id: 'pearl',
    label: 'Pearl / Test16 (rpc.pearl.testnets.gno.land)',
    remote: 'https://rpc.pearl.testnets.gno.land:443',
    chainId: 'pearl-1',
  },
  {
    id: 'local',
    label: 'Local node (127.0.0.1:26657)',
    remote: 'http://127.0.0.1:26657',
    chainId: 'dev',
  },
];

/** Out-of-the-box network: mainnet. */
const DEFAULT_NETWORK = NETWORKS.find((n) => n.id === 'mainnet') ?? NETWORKS[0];

/**
 * How a key password reaches gnokey when unlocking a key (to sign or export):
 *  - 'prompt'   : gnokey prompts on the real terminal; the password never
 *                 enters gnokey-tui. Implemented by suspending Ink and running
 *                 gnokey with inherited stdio. Most secure default.
 *  - 'keychain' : commands run through the `gnokeykc` binary, which reads the
 *                 password from the OS keychain (`gnokeykc kc set`). Nothing is
 *                 typed or held by gnokey-tui.
 *  - 'stdin'    : gnokey-tui collects the password and pipes it to gnokey via
 *                 -insecure-password-stdin. Explicit opt-in for scripting/CI.
 */
export type PasswordSource = 'prompt' | 'keychain' | 'stdin';

export const PASSWORD_SOURCES: Array<{
  value: PasswordSource;
  label: string;
  blurb: string;
}> = [
  {
    value: 'prompt',
    label: 'Prompt in terminal (most secure)',
    blurb: "gnokey asks for the password itself; it never enters gnokey-tui.",
  },
  {
    value: 'keychain',
    label: 'OS keychain (gnokeykc)',
    blurb: 'Stored once via `gnokeykc kc set`; nothing is typed or held here.',
  },
  {
    value: 'stdin',
    label: 'Send via stdin (insecure; scripting)',
    blurb: 'gnokey-tui collects the password and pipes it to gnokey.',
  },
];

export interface Settings {
  /** Path to the gnokey binary. */
  bin: string;
  /** RPC endpoint (-remote). */
  remote: string;
  /** Chain ID used for signing (-chainid). */
  chainId: string;
  /** gnokey home directory (-home); empty means gnokey's own default. */
  home: string;
  /** How key passwords are supplied to gnokey. */
  passwordSource: PasswordSource;
  /** Binary used for keychain mode (wraps gnokey with OS-keychain passwords). */
  kcBin: string;
  /** Last key name used, to preselect it in forms. */
  lastKey?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  bin: 'gnokey',
  remote: DEFAULT_NETWORK.remote,
  chainId: DEFAULT_NETWORK.chainId,
  home: '',
  passwordSource: 'prompt',
  kcBin: 'gnokeykc',
};

export function passwordSourceLabel(s: Settings): string {
  return (
    PASSWORD_SOURCES.find((p) => p.value === s.passwordSource)?.label ??
    s.passwordSource
  );
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), '.config');
  return join(base, 'gnokey-tui');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

/** Load persisted settings, falling back to defaults on any error. */
export function loadSettings(): Settings {
  try {
    const raw = readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings to disk. Errors are swallowed (best-effort). */
export function saveSettings(settings: Settings): void {
  try {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  } catch {
    /* best-effort; a read-only home just means settings don't persist */
  }
}

/** Human-readable label for the current remote, if it matches a known network. */
export function networkLabel(settings: Settings): string {
  const match = NETWORKS.find(
    (n) => n.remote === settings.remote && n.chainId === settings.chainId,
  );
  return match ? match.label.split(' (')[0] : 'Custom';
}

export function settingsConfigPath(): string {
  return configPath();
}

export function homeLabel(settings: Settings): string {
  if (settings.home && settings.home.trim()) return settings.home;
  return `${dirExists(defaultGnoHome()) ? '' : ''}gnokey default`;
}

function dirExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

// Mirror of gnovm/pkg/gnoenv.HomeDir, for display only. gnokey itself resolves
// its home; we never pass -home unless the user set one explicitly.
function defaultGnoHome(): string {
  if (process.env.GNOHOME) return process.env.GNOHOME;
  if (process.env.GNO_HOME) return process.env.GNO_HOME;
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'gno');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), '.config'), 'gno');
}
