// Entry point. Parses a couple of top-level flags, then runs the app in a
// mount/run/remount loop: the app renders until it either exits (quit) or
// requests an interactive gnokey run, in which case Ink is unmounted, gnokey
// runs with the terminal inherited (so it can prompt for a password itself),
// and the app is re-mounted.
import readline from 'node:readline';
import { render } from 'ink';
import { settingsConfigPath } from './config.ts';
import { runGnokeyInherited } from './gnokey/exec.ts';
import { App } from './ui/App.tsx';
import { interactiveStore } from './ui/interactiveStore.ts';
import { launch, parseActingArgs } from './ui/launch.ts';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      "gnokey-tui — a friendlier terminal UI for gno.land's gnokey",
      '',
      'Usage: gnokey-tui [flags]',
      '',
      'An interactive TUI. It wraps the `gnokey` binary, so gnokey must be',
      'installed and on your PATH (or set a custom path in Settings).',
      '',
      `Settings are stored at: ${settingsConfigPath()}`,
      '',
      'Flags:',
      '  -a, --address <bech32>   act as this address (watch-only ok); build',
      '                           unsigned txs + CLI commands for an airgapped signer',
      '      --account <name>     act as this keybase key (by name)',
      '  -h, --help               show this help',
      '  -v, --version            show version',
    ].join('\n'),
  );
  process.exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
  console.log('gnokey-tui 0.1.0');
  process.exit(0);
}

launch.set(parseActingArgs(argv));

if (!process.stdin.isTTY) {
  console.error(
    'gnokey-tui is an interactive app and needs a TTY. Run it directly in a terminal.',
  );
  process.exit(1);
}

function pressEnter(): Promise<void> {
  // Ink unrefs stdin when it disables raw mode on unmount. Without re-ref'ing,
  // nothing keeps the event loop alive while we wait, so Node exits with this
  // await unsettled. Ink refs it again when the app re-mounts.
  process.stdin.ref();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => {
    rl.question('\n\x1b[2m[press Enter to return to gnokey-tui]\x1b[0m ', () => {
      rl.close();
      process.stdin.unref();
      resolve();
    });
  });
}

// Main loop. Each iteration mounts the app; when it unmounts we check whether
// it asked us to run gnokey interactively before mounting again.
// eslint-disable-next-line no-constant-condition
while (true) {
  const app = render(<App />);
  await app.waitUntilExit();

  const pending = interactiveStore.takePending();
  if (!pending) break; // real quit

  // Ink has released the terminal. Run gnokey with inherited stdio so it owns
  // the TTY and prompts for the password with no echo — the password never
  // touches this process.
  process.stdout.write('\n' + pending.header + '\n');
  const code = runGnokeyInherited(pending.bin, pending.args);
  interactiveStore.setFlash(
    code === 0
      ? pending.flash
      : `${pending.flash} (gnokey exited with an error — see output above)`,
  );
  await pressEnter();
}
