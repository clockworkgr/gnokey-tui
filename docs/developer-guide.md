# gnokey-tui — Developer Guide

How the tool is built, and how to extend it. For the end-user walkthrough see the
[User Guide](user-guide.md).

- [Philosophy](#philosophy)
- [Architecture](#architecture)
- [The wrapper layer](#the-wrapper-layer)
- [Password strategies & the interactive loop](#password-strategies--the-interactive-loop)
- [Acting accounts & airgap prep](#acting-accounts--airgap-prep)
- [The UI layer](#the-ui-layer)
- [Extending the tool](#extending-the-tool)
- [Testing](#testing)
- [Regenerating screenshots](#regenerating-screenshots)
- [Conventions & gotchas](#conventions--gotchas)

---

## Philosophy

gnokey-tui is a **thin shell over the `gnokey` binary**, not a re-implementation.
Each action builds a `gnokey` argument vector, spawns the binary, and parses its
human-readable output back into structured data. This keeps the tool correct by
construction — it inherits gnokey's exact signing, key storage, and encoding —
and resilient to internal gno changes, since it depends only on gnokey's stable
CLI.

There is no build step: it runs the TypeScript sources directly through
[`tsx`](https://github.com/privatenumber/tsx). The UI is
[Ink](https://github.com/vadimdemedes/ink) (React for the terminal) with
[`@inkjs/ui`](https://github.com/vadimdemedes/ink-ui) components.

## Architecture

```
src/
  cli.tsx              entry point: flag parsing, the mount/run/remount loop
  config.ts            network presets, password sources, persisted settings
  format.ts            coin / address / byte formatting
  gnokey/
    exec.ts            spawns gnokey (piped, or with an inherited terminal)
    parse.ts           parsers for gnokey's text output (keys, query, tx, errors)
    api.ts             typed command builders → Cmd descriptors + runners
    authexec.ts        password-strategy resolution + the planPwCommand primitive
    types.ts           shared types
  ui/
    App.tsx            global state, startup check, screen router
    context.tsx        app context + screen-stack navigation + ActingAccount
    interactiveStore.ts  module store that survives Ink unmount/remount
    launch.ts          --address / --account parsing → acting account
    theme.ts           colors + glyphs
    components.tsx     Header, StatusBar, Panel, Field, KeyTable, CommandPreview…
    PromptSequence.tsx sequential form helper
    screens/           Home, Keys, AddKey, Query, Account, Tx, Settings, About
test/                  unit tests, a headless render test
docs/                  this guide, the user guide, and shots/
```

Data flows one way: a screen builds a `Cmd` via `api.ts`, `exec.ts` runs it, and
`parse.ts` turns the output into typed data the screen renders.

## The wrapper layer

**`Cmd`** (in `api.ts`) is the unit of work — an argv plus optional stdin:

```ts
interface Cmd {
  args: string[];
  stdinLines?: string[];   // fed to gnokey's stdin (e.g. a password)
  redactStdin?: boolean;
  timeoutMs?: number;
}
```

- **`exec.ts`** — `runGnokey(bin, args, opts)` spawns gnokey with piped stdio and
  captures stdout/stderr; it never rejects on a non-zero exit (the caller
  inspects `code`/`stderr`). `runGnokeyInherited(bin, args)` runs gnokey with the
  **real terminal inherited**, used by the prompt password strategy.
- **`api.ts`** — one builder per gnokey subcommand (`listKeysCmd`, `addKeyCmd`,
  `deleteKeyCmd`, `exportKeyCmd`, `importKeyCmd`, `queryCmd`, `txCmd`, plus the
  `sendFields`/`callFields`/… field builders). Each returns a `Cmd`. Passwords
  are only ever placed on stdin, never in argv, so `previewCmd()` output is always
  safe to display. Higher-level helpers (`listKeys`, `query`, `getAccount`,
  `getBalance`, `txOutcome`) run a `Cmd` and parse the result.
- **`parse.ts`** — tolerant parsers for gnokey's output: `parseKeyList`,
  `parseQuery`, `parseAccount`, `parseGasPrice`, `parseTxMetrics`, `parseError`
  (unwraps the boxed `--= Error =--` format and Go `errorString` noise), and
  `isErrorOutput`.

## Password strategies & the interactive loop

A key password can reach gnokey three ways, resolved in **`authexec.ts`**:

```ts
type PwStrategy = 'stdin' | 'keychain' | 'interactive';
resolveStrategy(settings, keyType?, { noKeychain? }): PwStrategy
```

- `stdin` — gnokey-tui pipes the password (`-insecure-password-stdin`).
- `keychain` — run through the `gnokeykc` binary; it reads the OS keychain.
- `interactive` — gnokey owns the terminal and prompts itself. **Ledger keys
  always resolve to `interactive`.**

The single dispatch primitive is **`planPwCommand`**, which every password action
(Tx broadcast, Keys delete/export/import, AddKey) routes through:

```ts
planPwCommand(settings, opts, stdinCmd): PwPlan
//   { kind: 'interactive', bin, args }   → run with the terminal inherited
// | { kind: 'piped', bin, cmd }          → run(bin, cmd), parse output in-app
```

`stdinCmd` is always the full stdin-form command; `planPwCommand` strips the
password flag and stdin lines for the interactive and keychain plans (via
`stripAuth`).

**The interactive loop.** Ink holds the terminal in raw mode, so gnokey can't run
its own no-echo prompt while Ink is mounted. To let it prompt, a screen calls
`runInteractive(args, header, flash)` from context. That stashes the pending
command in `interactiveStore` and calls Ink's `exit()`. The top-level loop in
`cli.tsx` then:

1. `render(<App/>)` and `await waitUntilExit()`.
2. If a command is pending, Ink has released the terminal — run it with
   `runGnokeyInherited` (gnokey prompts on the real TTY), pause for a keypress,
   and loop (re-mount the app, which shows the `flash` message).
3. Otherwise, quit.

`interactiveStore` also caches the gnokey version keyed by binary, so the
re-mount doesn't re-run the startup check.

## Acting accounts & airgap prep

An **acting account** (`ActingAccount` in `context.tsx`) is who a transaction is
built for. It comes from the `--address`/`--account` launch flags (parsed in
`launch.ts`, resolved against the keybase in `App.tsx`) or from picking a
watch-only address in the Tx flow.

In `Tx.tsx`, an `Actor` carries the positional `key`, whether it `canSign` here,
and a `master` field. For an address **not** in the keybase, `master` is set to
that address; `txCmd` then adds gnokey's `-master <addr>` **only in the unsigned
build**, which lets gnokey construct a correctly-addressed unsigned tx without a
keybase entry. A real broadcast never uses `-master`.

**Prepare for airgapped signing** (`prepareAirgap`) builds the unsigned tx, writes
it to a file, queries the account number/sequence, and emits the `gnokey sign` /
`gnokey broadcast` command pair via `airgapCommands`. Watch-only accounts get
only this path (they can't sign here); signing keys get it alongside
estimate/broadcast.

## The UI layer

- **`App.tsx`** owns global state (settings, keys, gnokey version, acting
  account, flash), runs the startup check, and routes to a screen based on a
  navigation stack.
- **`context.tsx`** exposes that state plus `nav` (a screen stack: `go`,
  `replace`, `back`) and `runInteractive`.
- **Screens** are self-contained state machines. Most use a discriminated
  `Mode` union and render one branch per mode.
- **`PromptSequence`** renders a sequential form (one field at a time, secrets
  masked) and calls `onDone(values)`. **`components.tsx`** holds the shared
  presentational pieces.

## Extending the tool

**Add a query.** Append a spec to `SPECS` in `screens/Query.tsx` with its
prompts, a `build(v)` that returns `{ path, data? }`, and an optional `format`
renderer. The `queryCmd`/`query` helpers already handle execution.

**Add a transaction kind.** Add a `TxKind` and its metadata to `KIND_META` in
`screens/Tx.tsx`, a `promptsFor` case, a `buildSpec` case, and a field builder in
`api.ts`. The actor/password/airgap machinery is shared.

**Add a screen.** Create `screens/Foo.tsx`, register it in the `Screen` switch in
`App.tsx`, and navigate to it with `nav.go('foo')`.

**Add a gnokey command.** Add a builder to `api.ts` returning a `Cmd`; if it
needs a password, build the stdin form (with `-insecure-password-stdin` and
`stdinLines`) and route it through `planPwCommand` so it works in all three
strategies.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx
```

- **Unit tests** (`test/parse.test.ts`, `authexec.test.ts`, `airgap.test.ts`)
  cover the parsers, strategy resolution, `planPwCommand`, the `-master` gating,
  and the airgap command builder, using real captured gnokey output.
- **Render test** (`test/render.test.tsx`) mounts the real Ink app with
  [`ink-testing-library`](https://github.com/vadimdemedes/ink-testing-library),
  boots it against a keybase, and checks navigation. It needs a keybase:

  ```bash
  KBHOME=/path/to/gno/home npm test
  ```

  Without `KBHOME` it skips (so CI stays green).

## Regenerating screenshots

Screenshots in `docs/shots/` are produced by rendering the app headlessly,
converting the ANSI frames to styled HTML "terminal window" cards, and
screenshotting them with headless Chrome at 2×. The generator is a throwaway
script under `test/` (so it inherits the automatic JSX runtime — see gotchas). To
refresh them, re-run that pipeline against a demo keybase; for the airgap shots,
point `GNOHOME` at an empty directory so the acting address is watch-only.

## Conventions & gotchas

- **tsx + tsconfig `include`.** tsx applies the automatic JSX runtime
  (`jsx: react-jsx`) **only to files matched by tsconfig `include`**. A `.tsx`
  file outside `include` (e.g. a new dir) compiles with the classic runtime and
  throws `ReferenceError: React is not defined` at runtime, even though `tsc`
  passes. Keep `.tsx` under `src/**` or `test/**`, or extend `include`.
- **Passwords never touch argv.** Only stdin (`stdin` strategy) or the inherited
  terminal (`interactive`). This is what makes the command preview safe to show.
- **`-master` is unsigned-only.** It sets an arbitrary caller for building an
  unsigned tx; it must never reach a real broadcast (that takes gnokey's
  session-signing path).
- **Chain ID `gnoland-1` vs `gnoland1`.** Mainnet is `gnoland-1` (hyphen); the
  pre-launch betanet was `gnoland1`. Signing with the wrong one is invalid.
- **Ink owns the TTY.** Anything that needs gnokey to read the terminal directly
  must go through the `runInteractive` → unmount → inherited-run → re-mount loop.
- **Placement.** This tool lives under `misc/` (alongside `misc/gnojs`) rather
  than `contribs/`, which currently accepts only Go and shell tools.
