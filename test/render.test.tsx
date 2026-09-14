// Headless render test: mounts the real Ink app against the scratch keybase
// (set via KBHOME) and checks that the home screen and a couple of navigations
// render without throwing. Skipped automatically if KBHOME is not provided.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { render } from 'ink-testing-library';
import { App } from '../src/ui/App.tsx';

const KBHOME = process.env.KBHOME;

async function waitFor(
  fn: () => string | undefined,
  pattern: RegExp,
  timeoutMs = 10_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = fn() ?? '';
    if (pattern.test(frame)) return frame;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${pattern}\nlast frame:\n${fn() ?? ''}`);
}

test(
  'renders home screen and navigates into Keys',
  { skip: KBHOME ? false : 'set KBHOME to a gnokey keybase to run' },
  async () => {
    // Point settings at a scratch config that uses the test keybase + Betanet.
    const xdg = mkdtempSync(join(tmpdir(), 'gktui-xdg-'));
    process.env.XDG_CONFIG_HOME = xdg;
    const cfgDir = join(xdg, 'gnokey-tui');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, 'config.json'),
      JSON.stringify({
        bin: 'gnokey',
        remote: 'https://rpc.gno.land:443',
        chainId: 'gnoland-1',
        home: KBHOME,
      }),
    );

    const { lastFrame, stdin, unmount } = render(<App />);

    // Boot check + home menu.
    const home = await waitFor(lastFrame, /What would you like to do\?/);
    assert.match(home, /gnokey-tui/);
    assert.match(home, /Keys/);
    assert.match(home, /Mainnet/); // status bar shows the network label
    assert.match(home, /gnokey version|gnokey HEAD|gnokey/); // version line

    // Enter selects the first menu item (Keys).
    stdin.write('\r');
    const keys = await waitFor(lastFrame, /keybase/);
    assert.match(keys, /keybase/);

    unmount();
  },
);
