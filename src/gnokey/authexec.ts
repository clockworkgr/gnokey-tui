// Resolves how a password-requiring command should be executed, based on the
// configured password source and the key type.
import type { Settings } from '../config.ts';
import { stripAuth, type Cmd } from './api.ts';

export type PwStrategy = 'stdin' | 'keychain' | 'interactive';

interface StrategyOpts {
  /** Some actions (import, recover) can't use the shared keychain password. */
  noKeychain?: boolean;
}

/**
 * Decide the execution strategy for a password action.
 *  - A Ledger key never has a disk password worth piping, and its signing shows
 *    device prompts, so it always runs interactively (inherited terminal).
 *  - Otherwise the configured password source decides.
 */
export function resolveStrategy(
  settings: Settings,
  keyType?: string,
  opts: StrategyOpts = {},
): PwStrategy {
  if (keyType === 'ledger') return 'interactive';
  switch (settings.passwordSource) {
    case 'stdin':
      return 'stdin';
    case 'keychain':
      return opts.noKeychain ? 'interactive' : 'keychain';
    case 'prompt':
    default:
      return 'interactive';
  }
}

/** True when gnokey-tui itself must collect the password (stdin strategy). */
export function needsInAppPassword(
  settings: Settings,
  keyType?: string,
  opts: StrategyOpts = {},
): boolean {
  return resolveStrategy(settings, keyType, opts) === 'stdin';
}

/** The binary to run for a given strategy (gnokeykc for keychain, else gnokey). */
export function binFor(settings: Settings, strategy: PwStrategy): string {
  return strategy === 'keychain' ? settings.kcBin || 'gnokeykc' : settings.bin;
}

/** How to run a password-requiring command under the resolved strategy. */
export type PwPlan =
  | { kind: 'interactive'; bin: string; args: string[] }
  | { kind: 'piped'; bin: string; cmd: Cmd };

/**
 * Resolve how to run a password-requiring command. `stdinCmd` must be the full
 * stdin-form command (with -insecure-password-stdin and its stdin lines set by
 * the caller); the interactive and keychain plans strip that authentication,
 * since gnokey or gnokeykc supplies the password instead.
 *
 * Screens execute the plan themselves: 'interactive' via context.runInteractive
 * (gnokey owns the terminal), 'piped' via run(bin, cmd) with their own output
 * handling.
 */
export function planPwCommand(
  settings: Settings,
  opts: StrategyOpts & { keyType?: string },
  stdinCmd: Cmd,
): PwPlan {
  const strategy = resolveStrategy(settings, opts.keyType, opts);
  switch (strategy) {
    case 'interactive':
      return { kind: 'interactive', bin: settings.bin, args: stripAuth(stdinCmd).args };
    case 'keychain':
      return { kind: 'piped', bin: binFor(settings, 'keychain'), cmd: stripAuth(stdinCmd) };
    default:
      return { kind: 'piped', bin: settings.bin, cmd: stdinCmd };
  }
}

/** One-line note describing how the password will be supplied, for the UI. */
export function pwModeNote(
  settings: Settings,
  keyType?: string,
  opts: StrategyOpts = {},
): string {
  switch (resolveStrategy(settings, keyType, opts)) {
    case 'interactive':
      return keyType === 'ledger'
        ? 'gnokey will use your Ledger device in the terminal.'
        : 'gnokey will prompt for the password in the terminal.';
    case 'keychain':
      return 'password comes from the OS keychain (gnokeykc).';
    default:
      return 'password is piped to gnokey (insecure stdin).';
  }
}

/** Framed banner printed to the raw terminal before an interactive gnokey run. */
export function interactiveHeader(title: string, note: string): string {
  const bar = '─'.repeat(56);
  return [bar, ` ${title}`, ` ${note}`, bar].join('\n');
}
