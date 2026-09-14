// A tiny module-level store that survives Ink unmount/remount cycles.
//
// The 'prompt' password strategy needs gnokey to own the real terminal, which
// means Ink must fully release it. We do that by unmounting the Ink app,
// running gnokey with inherited stdio, then re-rendering. This store carries
// the pending command out to the top-level loop (cli.tsx) and carries a short
// status message back in for the freshly mounted app to show.
export interface PendingInteractive {
  bin: string;
  args: string[];
  /** Printed to the raw terminal before gnokey runs, for context. */
  header: string;
  /** Shown on return, once the app re-mounts. */
  flash: string;
}

let pending: PendingInteractive | null = null;
let flash: string | null = null;
let cached: { bin: string; version: string } | null = null;

export const interactiveStore = {
  setPending(p: PendingInteractive) {
    pending = p;
  },
  takePending(): PendingInteractive | null {
    const p = pending;
    pending = null;
    return p;
  },
  setFlash(f: string) {
    flash = f;
  },
  takeFlash(): string | null {
    const f = flash;
    flash = null;
    return f;
  },
  // Cache the gnokey version keyed by binary, so a remount after an interactive
  // run doesn't flicker through the startup check. Invalid once the bin changes.
  setVersion(bin: string, version: string) {
    cached = { bin, version };
  },
  getVersion(bin: string): string | null {
    return cached && cached.bin === bin ? cached.version : null;
  },
};
