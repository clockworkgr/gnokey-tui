// Global app context: settings, the cached key list, gnokey version, and a
// simple screen-stack router shared by every screen.
import { createContext, useContext } from 'react';
import type { Settings } from '../config.ts';
import type { KeyInfo } from '../gnokey/types.ts';

export interface ScreenEntry {
  name: string;
  params?: Record<string, unknown>;
}

export interface Nav {
  stack: ScreenEntry[];
  go: (name: string, params?: Record<string, unknown>) => void;
  replace: (name: string, params?: Record<string, unknown>) => void;
  back: () => void;
}

/**
 * The account the TUI acts as when building transactions. It may be a signing
 * key in the keybase, a watch-only reference, or a bare address not in the
 * keybase at all (for building unsigned txs + CLI commands for an airgapped
 * signer). Set via the --address/--account launch flags, or in-app.
 */
export interface ActingAccount {
  address: string;
  name?: string;
  keyType?: string;
  inKeybase: boolean;
  /** True only for a local/ledger key that can actually sign here. */
  canSign: boolean;
}

export interface AppContextValue {
  settings: Settings;
  setSettings: (next: Settings) => void;
  keys: KeyInfo[];
  keysLoading: boolean;
  keysError?: string;
  refreshKeys: () => Promise<void>;
  version: string;
  nav: Nav;
  /** The acting account from launch flags, if any. */
  acting?: ActingAccount;
  /**
   * Suspend the UI and run a gnokey command with the real terminal inherited,
   * so gnokey can prompt for a password itself. The app unmounts, gnokey runs,
   * and the app re-mounts at Home showing `flash`. Used by the 'prompt' /
   * Ledger password strategy.
   */
  runInteractive: (args: string[], header: string, flash: string) => void;
  /** Short status message to surface after an interactive run, if any. */
  flash?: string;
  clearFlash: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContext.Provider');
  return ctx;
}
