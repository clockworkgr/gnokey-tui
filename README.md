# gnokey-tui

A friendlier terminal UI for [`gnokey`](../../gno.land/cmd/gnokey), gno.land's
command-line wallet and chain client. It wraps the real `gnokey` binary in an
interactive [Ink](https://github.com/vadimdemedes/ink) (React-for-the-terminal)
interface: guided forms instead of remembered flags, formatted output instead
of raw JSON, a live command preview, and a built-in gas estimator.

Every action runs an actual `gnokey` command. Nothing here re-implements
signing, key storage, or crypto — your keys and behavior are exactly gnokey's.

![gnokey-tui home screen](docs/shots/01-home.png)

## Documentation

- **[User Guide](docs/user-guide.md)** — full walkthrough with screenshots:
  networks, keys, password handling, querying, transactions, and airgapped
  signing.
- **[Developer Guide](docs/developer-guide.md)** — architecture, the wrapper
  model, password strategies, and how to extend the tool.

## Requirements

- **Node.js ≥ 20**
- **`gnokey`** installed and on your `PATH` (or point to it in Settings).
  Install it from the monorepo root with `make install.gnokey`.

## Install & run

```bash
cd misc/gnokey-tui
npm install
npm start          # launches the TUI

# Act as a specific address/account (watch-only ok — see Airgapped signing):
npm start -- --address g1youraddress…
npm start -- --account mykey
```

Or, after `npm install`, via the bundled launcher:

```bash
./bin/gnokey-tui.mjs
./bin/gnokey-tui.mjs --address g1youraddress…
```

Flags: `-a, --address <bech32>`, `--account <name>`, `-h, --help`, `-v, --version`.

There is no build step — it runs the TypeScript sources directly through
[`tsx`](https://github.com/privatenumber/tsx).

## What it can do

It exposes the full gnokey surface, organized by task:

| Area | gnokey commands wrapped |
|------|-------------------------|
| **Keys** | `list`, `add` (new / recover), `generate`, `delete`, `export`, `import` |
| **Query state** | `query` for `vm/qrender`, `vm/qeval`, `vm/qfuncs`, `vm/qfile`, `vm/qdoc`, `vm/qpaths`, `vm/qstorage`, `auth/accounts`, `bank/balances`, `bank/supply`, `auth/gasprice`, and any raw path |
| **Account overview** | `bank/balances` + `auth/accounts` + `auth/gasprice`, combined and formatted |
| **Send / Call / Run / Deploy** | `maketx send` / `call` / `run` / `addpkg` |

Transaction screens follow a **build → estimate → confirm → broadcast** flow:

1. Pick a signing key and fill a guided form.
2. See the **exact `gnokey` command** that will run.
3. Optionally **estimate gas** with a dry run (`-simulate only`), which shows
   the suggested gas and fee without spending anything.
4. **Broadcast**, or export the **unsigned tx JSON** for airgapped signing.

### Airgapped signing / watch-only

The tool can act as any address — including one whose key it does not hold — to
prepare transactions for an offline signer. Pass it on launch:

```bash
gnokey-tui --address g1yoursigner…   # any bech32, need not be in the keybase
gnokey-tui --account mykey           # a keybase key, by name
```

The acting account is shown in the status bar, and you can also pick
**"Enter a watch-only address"** in any transaction flow. For a watch-only
account, the transaction screen offers **Prepare for airgapped signing**, which:

1. Builds the unsigned tx and writes it to a file you choose.
2. Queries the account number and sequence from the current network.
3. Prints the exact two commands to run — `gnokey sign …` on the offline machine
   that holds the key, then `gnokey broadcast …` back on the online machine.

The unsigned tx is built with gnokey (via `-master` for an address not in the
keybase), so it carries gnokey's exact encoding and signs cleanly offline.

Quality-of-life wins over the bare CLI:

- **No shell-quoting for arguments.** Call arguments are passed to `gnokey`
  verbatim (no shell in between), so strings with spaces or quotes just work.
- **Network switcher.** Presets for Mainnet (`gnoland-1`, the default), Staging,
  Pearl/Test16, and a local node; the active network, chain ID, and home dir are
  always on screen. Mainnet is live at rpc.gno.land.
- **Formatted results.** ugnot amounts render as GNOT, JSON is pretty-printed,
  `vm/qfuncs` becomes a readable signature list, gas price becomes a rate.
- **Persistent settings** at `~/.config/gnokey-tui/config.json`.

## Password handling

Unlocking a key (to sign a transaction or export it) needs its password. How
that password reaches gnokey is configurable under **Settings › Password
handling**:

| Mode | How it works | Password touches gnokey-tui? |
|------|--------------|------------------------------|
| **Prompt in terminal** (default) | gnokey-tui suspends, hands gnokey the real terminal, and gnokey prompts with its own no-echo reader | No |
| **OS keychain (gnokeykc)** | commands run through [`gnokeykc`](../../contribs/gnokeykc), which reads the password from the OS keychain (`gnokeykc kc set`) | No |
| **Send via stdin** | gnokey-tui collects the password and pipes it to gnokey via `-insecure-password-stdin` | Yes — opt-in, for scripting on a trusted machine |

Two things sidestep passwords entirely:

- **Ledger keys** sign on-device, so they always run in the terminal-prompt path
  and never need a disk password.
- **Airgapped signing:** use "Show unsigned tx JSON", then sign on an offline
  machine with plain `gnokey sign` and broadcast the signed file.

In every mode the password is kept out of argv, so the command preview is always
safe to show. The default keeps the password out of this process entirely; only
"Send via stdin" holds it in memory, briefly, for the one command.

Keychain mode requires the `gnokeykc` binary (set its path in Settings if it's
not on your PATH). Importing an armored key never uses the keychain, since the
armor's password is external.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # parser unit tests + a headless render test
```

The render test and a live api smoke test need a real keybase; point them at
one with `KBHOME`:

```bash
KBHOME=/path/to/gno/home npm test
```

## Architecture

```
src/
  cli.tsx            entry point (flag parsing, renders <App/>)
  config.ts          network presets + persisted settings
  format.ts          coin / address / byte formatting
  gnokey/
    exec.ts          spawns the gnokey binary, feeds stdin, captures output
    parse.ts         parsers for gnokey's text output (keys, query, tx, errors)
    api.ts           typed command builders → Cmd descriptors + runners
    types.ts         shared types
  ui/
    App.tsx          global state, startup check, screen router
    context.tsx      app context + screen-stack navigation
    theme.ts         colors + glyphs
    components.tsx    Header, StatusBar, Panel, Field, KeyTable, …
    PromptSequence.tsx  sequential form helper
    screens/         Home, Keys, AddKey, Query, Account, Tx, Settings, About
```

The wrapper is deliberately a thin shell over the binary: `api.ts` builds a
`Cmd` (argv + optional stdin), `exec.ts` runs it, and `parse.ts` turns the
human-readable output back into structured data. This keeps the tool correct by
construction — it inherits gnokey's exact semantics — and resilient to internal
gno changes, since it only depends on gnokey's stable CLI.

## Notes

This tool lives under `misc/` (alongside `misc/gnojs`) rather than `contribs/`,
because `contribs/` currently accepts only Go and shell tools. It is
experimental and community-maintained.
