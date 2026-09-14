import type React from 'react';
import { writeFileSync } from 'node:fs';
import { PasswordInput, Select, Spinner, StatusMessage, TextInput } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import {
  addpkgFields,
  airgapCommands,
  callFields,
  getAccount,
  previewCmd,
  run,
  runFields,
  sendFields,
  txCmd,
  txOutcome,
  type TxKind,
  type TxSpec,
} from '../../gnokey/api.ts';
import {
  interactiveHeader,
  needsInAppPassword,
  planPwCommand,
  pwModeNote,
} from '../../gnokey/authexec.ts';
import { isErrorOutput, parseError } from '../../gnokey/parse.ts';
import type { TxMetrics } from '../../gnokey/types.ts';
import { formatCoins, shortAddr } from '../../format.ts';
import { useApp, type ActingAccount } from '../context.tsx';
import { CommandPreview, Field, Header, Hint, Panel } from '../components.tsx';
import { PromptSequence, type Prompt } from '../PromptSequence.tsx';
import { color, glyph } from '../theme.ts';

/**
 * The account a transaction is built for. `key` is the positional gnokey
 * expects (a keybase name or an address). `master` is set to the address only
 * when it is not a keybase entry, so an unsigned tx can still be built for it
 * (watch-only / airgapped signing).
 */
interface Actor {
  address: string;
  key: string;
  name?: string;
  keyType?: string;
  canSign: boolean;
  master?: string;
}

function actorFromActing(a: ActingAccount): Actor {
  return {
    address: a.address,
    key: a.name ?? a.address,
    name: a.name,
    keyType: a.keyType,
    canSign: a.canSign,
    master: a.inKeybase ? undefined : a.address,
  };
}

const KIND_META: Record<
  TxKind,
  { title: string; blurb: string; gasWanted: string; needsArgs?: boolean }
> = {
  send: { title: 'send tokens', blurb: 'Transfer coins to another address.', gasWanted: '100000' },
  call: { title: 'call a realm', blurb: 'Invoke an exported realm function.', gasWanted: '2000000', needsArgs: true },
  run: { title: 'run a script', blurb: 'Execute a local Gno script on-chain via main().', gasWanted: '5000000' },
  addpkg: { title: 'deploy a package', blurb: 'Upload a package or realm to the chain.', gasWanted: '5000000' },
};

function promptsFor(kind: TxKind, gasWanted: string): Prompt[] {
  const gas: Prompt[] = [
    { key: 'gasWanted', label: 'Gas wanted', initial: gasWanted },
    { key: 'gasFee', label: 'Gas fee', initial: '1000000ugnot' },
    { key: 'memo', label: 'Memo', optional: true },
  ];
  switch (kind) {
    case 'send':
      return [
        { key: 'to', label: 'Recipient address (g1…)' },
        { key: 'amount', label: 'Amount', placeholder: '100ugnot' },
        ...gas,
      ];
    case 'call':
      return [
        { key: 'pkgPath', label: 'Package path', placeholder: 'gno.land/r/…' },
        { key: 'func', label: 'Function name' },
        { key: 'send', label: 'Send with call', optional: true, placeholder: '(none)' },
        { key: 'maxDeposit', label: 'Max storage deposit', optional: true },
        ...gas,
      ];
    case 'run':
      return [
        { key: 'file', label: 'Path to .gno file or dir' },
        { key: 'send', label: 'Send with run', optional: true },
        { key: 'maxDeposit', label: 'Max storage deposit', optional: true },
        ...gas,
      ];
    case 'addpkg':
      return [
        { key: 'pkgPath', label: 'Package path', placeholder: 'gno.land/r/you/pkg' },
        { key: 'pkgDir', label: 'Local source directory' },
        { key: 'send', label: 'Send with deploy', optional: true },
        { key: 'maxDeposit', label: 'Max storage deposit', optional: true },
        ...gas,
      ];
  }
}

function buildSpec(
  kind: TxKind,
  actor: Actor,
  vals: Record<string, string>,
  args: string[],
): TxSpec {
  const common = {
    key: actor.key,
    master: actor.master,
    gasWanted: vals.gasWanted,
    gasFee: vals.gasFee,
    memo: vals.memo || undefined,
  };
  switch (kind) {
    case 'send':
      return { kind, ...common, fields: sendFields({ to: vals.to, amount: vals.amount }) };
    case 'call':
      return {
        kind,
        ...common,
        fields: callFields({
          pkgPath: vals.pkgPath,
          func: vals.func,
          args,
          send: vals.send || undefined,
          maxDeposit: vals.maxDeposit || undefined,
        }),
      };
    case 'run':
      return {
        kind,
        ...common,
        fields: runFields({ send: vals.send || undefined, maxDeposit: vals.maxDeposit || undefined }),
        extraPositional: vals.file,
      };
    case 'addpkg':
      return {
        kind,
        ...common,
        fields: addpkgFields({
          pkgPath: vals.pkgPath,
          pkgDir: vals.pkgDir,
          send: vals.send || undefined,
          maxDeposit: vals.maxDeposit || undefined,
        }),
      };
  }
}

type Mode =
  | { m: 'pickkey' }
  | { m: 'watchaddr' }
  | { m: 'fields'; actor: Actor }
  | { m: 'args'; actor: Actor; vals: Record<string, string> }
  | { m: 'password'; actor: Actor; spec: TxSpec }
  | {
      m: 'review';
      actor: Actor;
      spec: TxSpec;
      password: string;
      estimate?: TxMetrics;
      estimateError?: string;
    }
  | { m: 'airgap'; actor: Actor; spec: TxSpec }
  | {
      m: 'airgapDone';
      file: string;
      accountNumber: string;
      accountSequence: string;
      sign: string;
      broadcast: string;
      json: string;
      warn?: string;
    }
  | { m: 'working'; label: string }
  | { m: 'done'; ok: boolean; metrics?: TxMetrics; error?: string }
  | { m: 'unsigned'; text: string; actor: Actor; spec: TxSpec; password: string };

export function TxScreen({ params }: { params?: Record<string, unknown> }): React.ReactNode {
  const kind = ((params?.kind as TxKind) ?? 'send') as TxKind;
  const meta = KIND_META[kind];
  const { keys, settings, nav, runInteractive, acting } = useApp();
  const [mode, setMode] = useState<Mode>({ m: 'pickkey' });

  const signingKeys = keys.filter((k) => k.canSign);

  useInput((_i, key) => {
    if (key.escape) {
      if (mode.m === 'pickkey') nav.back();
      else if (mode.m === 'watchaddr' || mode.m === 'fields') setMode({ m: 'pickkey' });
      else if (mode.m === 'unsigned')
        setMode({ m: 'review', actor: mode.actor, spec: mode.spec, password: mode.password });
      // other modes: let their own controls handle navigation
    }
  });

  // After the form: watch-only accounts go straight to review (airgap only);
  // signers go to a password prompt for the stdin strategy, else to review.
  const afterForm = (actor: Actor, spec: TxSpec) => {
    if (actor.canSign && needsInAppPassword(settings, actor.keyType))
      setMode({ m: 'password', actor, spec });
    else setMode({ m: 'review', actor, spec, password: '' });
  };

  async function estimate(actor: Actor, spec: TxSpec, password: string) {
    // Estimate is only offered for the piped strategies.
    const plan = planPwCommand(settings, { keyType: actor.keyType }, {
      ...txCmd(settings, spec, 'only'),
      stdinLines: [password],
    });
    if (plan.kind !== 'piped') return;
    setMode({ m: 'working', label: 'Simulating (dry run)…' });
    try {
      const out = txOutcome(await run(plan.bin, plan.cmd));
      setMode({
        m: 'review',
        actor,
        spec,
        password,
        estimate: out.metrics,
        estimateError: out.ok ? undefined : out.error,
      });
    } catch (err) {
      setMode({ m: 'review', actor, spec, password, estimateError: (err as Error).message });
    }
  }

  async function broadcast(actor: Actor, spec: TxSpec, password: string) {
    const plan = planPwCommand(settings, { keyType: actor.keyType }, {
      ...txCmd(settings, spec, 'test'),
      stdinLines: [password],
    });

    if (plan.kind === 'interactive') {
      // Hand gnokey the terminal; it prompts for the password itself.
      runInteractive(
        plan.args,
        interactiveHeader(
          `gnokey · ${meta.title} — signing as ${spec.key}`,
          actor.keyType === 'ledger'
            ? 'Review and confirm on your Ledger device.'
            : "You'll be asked for your key password (input is hidden).",
        ),
        `${kind} transaction submitted as ${spec.key}.`,
      );
      return; // component unmounts
    }

    setMode({ m: 'working', label: 'Broadcasting…' });
    try {
      const out = txOutcome(await run(plan.bin, plan.cmd));
      setMode({ m: 'done', ok: out.ok, metrics: out.metrics, error: out.error });
    } catch (err) {
      setMode({ m: 'done', ok: false, error: (err as Error).message });
    }
  }

  async function showUnsigned(actor: Actor, spec: TxSpec, password: string) {
    setMode({ m: 'working', label: 'Building unsigned tx…' });
    const res = await run(settings.bin, txCmd(settings, spec, 'unsigned'));
    setMode({
      m: 'unsigned',
      text: res.stdout.trim() || res.stderr.trim(),
      actor,
      spec,
      password,
    });
  }

  // Build the unsigned tx, save it, fetch account number/sequence, and produce
  // the two gnokey commands for an airgapped signer.
  async function prepareAirgap(actor: Actor, spec: TxSpec, file: string) {
    setMode({ m: 'working', label: 'Building unsigned tx…' });
    try {
      const res = await run(settings.bin, txCmd(settings, spec, 'unsigned'));
      const json = res.stdout.trim();
      if (isErrorOutput(res.code, res.stderr) || !json.startsWith('{')) {
        setMode({ m: 'done', ok: false, error: parseError(res.stderr, res.stdout) });
        return;
      }
      writeFileSync(file, json + '\n');

      let accountNumber = '0';
      let accountSequence = '0';
      let warn: string | undefined;
      try {
        const acc = await getAccount(settings, actor.address);
        if (acc) {
          accountNumber = acc.accountNumber;
          accountSequence = acc.sequence;
        } else {
          warn =
            'account is not initialized on-chain — number/sequence default to 0. ' +
            'Fund it first; the account number is assigned on first receipt.';
        }
      } catch (err) {
        warn = `could not fetch account number/sequence: ${(err as Error).message}`;
      }

      const cmds = airgapCommands(settings, {
        txFile: file,
        keyName: actor.name ?? '<YOUR_KEY_NAME>',
        accountNumber,
        accountSequence,
      });
      setMode({
        m: 'airgapDone',
        file,
        accountNumber,
        accountSequence,
        sign: cmds.sign,
        broadcast: cmds.broadcast,
        json,
        warn,
      });
    } catch (err) {
      setMode({ m: 'done', ok: false, error: (err as Error).message });
    }
  }

  // ---- pick account -----------------------------------------------------
  if (mode.m === 'pickkey') {
    const options = [
      ...(acting
        ? [
            {
              label: `${glyph.check} Use ${acting.name ?? shortAddr(acting.address)} (from launch flag)`,
              value: '__acting',
            },
          ]
        : []),
      ...signingKeys.map((k) => ({
        label: `${k.name}  ${glyph.dot}  ${k.address}`,
        value: `key:${k.name}`,
      })),
      { label: `${glyph.arrow} Enter a watch-only address (airgap)…`, value: '__watch' },
      { label: `${glyph.arrow} Back`, value: '__back' },
    ];
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Text color={color.muted}>{meta.blurb}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={color.muted}>Act as:</Text>
          <Select
            visibleOptionCount={Math.min(options.length, 12)}
            options={options}
            onChange={(v) => {
              if (v === '__back') return nav.back();
              if (v === '__watch') return setMode({ m: 'watchaddr' });
              if (v === '__acting' && acting)
                return setMode({ m: 'fields', actor: actorFromActing(acting) });
              const name = v.slice(4);
              const k = signingKeys.find((x) => x.name === name);
              if (k)
                setMode({
                  m: 'fields',
                  actor: {
                    address: k.address,
                    key: k.name,
                    name: k.name,
                    keyType: k.type,
                    canSign: true,
                  },
                });
            }}
          />
        </Box>
        <Hint items={['↑↓ move', '⏎ select', 'esc back']} />
      </Box>
    );
  }

  // ---- watch-only address -----------------------------------------------
  if (mode.m === 'watchaddr') {
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Text color={color.muted}>
          Build an unsigned tx + CLI commands for this address (no key needed here).
        </Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={[{ key: 'address', label: 'Address (g1…)' }]}
            onCancel={() => setMode({ m: 'pickkey' })}
            onDone={(vals) => {
              const addr = vals.address;
              const k = keys.find((x) => x.address === addr);
              setMode({
                m: 'fields',
                actor: {
                  address: addr,
                  key: k?.name ?? addr,
                  name: k?.name,
                  keyType: k?.type,
                  canSign: k?.canSign ?? false,
                  master: k ? undefined : addr,
                },
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---- fields -----------------------------------------------------------
  if (mode.m === 'fields') {
    const actor = mode.actor;
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Text color={color.muted}>
          {actor.canSign ? 'Signing as ' : 'Acting as '}
          <Text color={color.accent}>{actor.name ?? actor.address}</Text>
          {actor.canSign ? null : (
            <Text color={color.amber}> (watch-only — airgap prep)</Text>
          )}
        </Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={promptsFor(kind, meta.gasWanted)}
            onCancel={() => setMode({ m: 'pickkey' })}
            onDone={(vals) => {
              if (meta.needsArgs) setMode({ m: 'args', actor, vals });
              else afterForm(actor, buildSpec(kind, actor, vals, []));
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---- args (call only) -------------------------------------------------
  if (mode.m === 'args') {
    const actor = mode.actor;
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Text color={color.muted}>
          Function arguments (each passed verbatim — no shell quoting needed).
        </Text>
        <Box marginTop={1}>
          <ListInput
            label="Argument"
            onDone={(args) => afterForm(actor, buildSpec(kind, actor, mode.vals, args))}
          />
        </Box>
      </Box>
    );
  }

  // ---- password ---------------------------------------------------------
  if (mode.m === 'password') {
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Text color={color.muted}>Password to decrypt the signing key:</Text>
        <Box marginTop={1} marginLeft={2}>
          <PasswordInput
            placeholder="••••••••"
            onSubmit={(pw) =>
              setMode({ m: 'review', actor: mode.actor, spec: mode.spec, password: pw })
            }
          />
        </Box>
        <Hint items={['⏎ continue', 'the password is sent to gnokey via stdin']} />
      </Box>
    );
  }

  // ---- review -----------------------------------------------------------
  if (mode.m === 'review') {
    const { actor, spec } = mode;
    const airgapOption = {
      label: `${glyph.key} Prepare for airgapped signing`,
      value: 'airgap',
    };
    const unsignedOption = { label: `${glyph.arrow} Show unsigned tx JSON`, value: 'unsigned' };
    const cancelOption = { label: `${glyph.cross} Cancel`, value: 'cancel' };

    if (!actor.canSign) {
      // Watch-only: cannot sign here, only prepare airgap artifacts.
      const command = previewCmd(settings.bin, txCmd(settings, spec, 'unsigned'));
      return (
        <Box flexDirection="column">
          <Header subtitle={meta.title} />
          <CommandPreview command={command} />
          <Box marginTop={1}>
            <Text color={color.muted}>
              {glyph.dot} watch-only for{' '}
              <Text color={color.text}>{actor.name ?? shortAddr(actor.address)}</Text> — no key
              here; build an unsigned tx for an airgapped signer.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Select
              options={[airgapOption, unsignedOption, cancelOption]}
              onChange={(v) => {
                if (v === 'airgap') return setMode({ m: 'airgap', actor, spec });
                if (v === 'unsigned') return void showUnsigned(actor, spec, '');
                return nav.back();
              }}
            />
          </Box>
          <Hint items={['esc cancel']} />
        </Box>
      );
    }

    const plan = planPwCommand(settings, { keyType: actor.keyType }, txCmd(settings, spec, 'test'));
    const command =
      plan.kind === 'interactive'
        ? previewCmd(plan.bin, { args: plan.args })
        : previewCmd(plan.bin, plan.cmd);
    // Gas estimate signs, so it only runs in-app for the piped strategies.
    const canEstimate = plan.kind !== 'interactive';
    const pwNote = pwModeNote(settings, actor.keyType);

    const options = [
      ...(canEstimate
        ? [{ label: `${glyph.coin} Estimate gas (dry run)`, value: 'estimate' }]
        : []),
      { label: `${glyph.warn} Broadcast now`, value: 'broadcast' },
      airgapOption,
      unsignedOption,
      cancelOption,
    ];

    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <CommandPreview command={command} />
        <Box marginTop={1}>
          <Text color={color.muted}>
            {glyph.dot} {pwNote}
          </Text>
        </Box>
        {mode.estimate ? (
          <Box marginTop={1}>
            <EstimatePanel metrics={mode.estimate} error={mode.estimateError} />
          </Box>
        ) : mode.estimateError ? (
          <Box marginTop={1}>
            <StatusMessage variant="error">{mode.estimateError}</StatusMessage>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Select
            options={options}
            onChange={(v) => {
              if (v === 'estimate') return void estimate(actor, spec, mode.password);
              if (v === 'broadcast') return void broadcast(actor, spec, mode.password);
              if (v === 'airgap') return setMode({ m: 'airgap', actor, spec });
              if (v === 'unsigned') return void showUnsigned(actor, spec, mode.password);
              return nav.back();
            }}
          />
        </Box>
        <Hint items={['dry run does not spend gas or move funds', 'esc cancel']} />
      </Box>
    );
  }

  // ---- airgap: choose output file ---------------------------------------
  if (mode.m === 'airgap') {
    const { actor, spec } = mode;
    const suggested = `./${actor.name ?? shortAddr(actor.address, 6, 4).replace(/…/g, '')}-${kind}.tx`;
    return (
      <Box flexDirection="column">
        <Header subtitle={`${meta.title} · airgap`} />
        <Text color={color.muted}>
          Save an unsigned tx to a file, then sign it on an offline machine and broadcast
          the signed file from here.
        </Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={[{ key: 'file', label: 'Unsigned tx output file', initial: suggested }]}
            onCancel={() => setMode({ m: 'review', actor, spec, password: '' })}
            onDone={(vals) => void prepareAirgap(actor, spec, vals.file)}
          />
        </Box>
      </Box>
    );
  }

  // ---- airgap: result ---------------------------------------------------
  if (mode.m === 'airgapDone') {
    return (
      <Box flexDirection="column">
        <Header subtitle={`${meta.title} · airgap`} />
        <StatusMessage variant="success">
          Unsigned tx written to {mode.file} ({mode.json.length} bytes)
        </StatusMessage>
        {mode.warn ? (
          <Box marginTop={1}>
            <Text color={color.amber}>
              {glyph.warn} {mode.warn}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Panel title="account (baked into the signature)" borderColor={color.muted}>
            <Field label="number" value={mode.accountNumber} />
            <Field label="sequence" value={mode.accountSequence} />
            <Field label="chain id" value={settings.chainId} />
          </Panel>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={color.muted}>1. On the AIRGAPPED machine (holds the key):</Text>
          <CommandPreview command={mode.sign} />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={color.muted}>2. Bring the signed file back, then from THIS machine:</Text>
          <CommandPreview command={mode.broadcast} />
        </Box>
        <Box marginTop={1}>
          <Select
            options={[
              { label: 'New transaction', value: 'again' },
              { label: 'Back to menu', value: 'menu' },
            ]}
            onChange={(v) => (v === 'again' ? setMode({ m: 'pickkey' }) : nav.back())}
          />
        </Box>
      </Box>
    );
  }

  // ---- unsigned ---------------------------------------------------------
  if (mode.m === 'unsigned') {
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Panel title="unsigned tx (amino json)" borderColor={color.muted}>
          <Text color={color.text}>{mode.text}</Text>
        </Panel>
        <Box marginTop={1}>
          <Select
            options={[{ label: 'Back to review', value: 'back' }]}
            onChange={() =>
              setMode({
                m: 'review',
                actor: mode.actor,
                spec: mode.spec,
                password: mode.password,
              })
            }
          />
        </Box>
      </Box>
    );
  }

  // ---- working ----------------------------------------------------------
  if (mode.m === 'working') {
    return (
      <Box flexDirection="column">
        <Header subtitle={meta.title} />
        <Spinner label={mode.label} />
      </Box>
    );
  }

  // ---- done -------------------------------------------------------------
  return (
    <Box flexDirection="column">
      <Header subtitle={meta.title} />
      {mode.ok ? (
        <StatusMessage variant="success">Transaction committed</StatusMessage>
      ) : (
        <StatusMessage variant="error">{mode.error ?? 'Transaction failed'}</StatusMessage>
      )}
      {mode.metrics ? (
        <Box marginTop={1}>
          <TxResult metrics={mode.metrics} showData={mode.ok} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'New transaction', value: 'again' },
            { label: 'Back to menu', value: 'menu' },
          ]}
          onChange={(v) => (v === 'again' ? setMode({ m: 'pickkey' }) : nav.back())}
        />
      </Box>
    </Box>
  );
}

function EstimatePanel({ metrics, error }: { metrics: TxMetrics; error?: string }): ReactNode {
  return (
    <Panel title="gas estimate" borderColor={color.amber}>
      {metrics.gasUsed ? <Field label="gas used" value={metrics.gasUsed} /> : null}
      {metrics.suggestedGas ? (
        <Field label="suggested" value={`${metrics.suggestedGas}  (+5% margin)`} valueColor={color.amber} />
      ) : null}
      {metrics.estimatedFee ? (
        <Field label="est. fee" value={metrics.estimatedFee} valueColor={color.accent} />
      ) : null}
      {metrics.info && !metrics.suggestedGas ? <Field label="info" value={metrics.info} /> : null}
      {error ? (
        <Box marginTop={1}>
          <Text color={color.red}>
            {glyph.cross} simulation failed: {error}
          </Text>
        </Box>
      ) : null}
    </Panel>
  );
}

function TxResult({ metrics, showData }: { metrics: TxMetrics; showData: boolean }): ReactNode {
  return (
    <Panel title="result" borderColor={color.accentDim}>
      {showData && metrics.data ? (
        <Box marginBottom={1}>
          <Text color={color.text}>{metrics.data}</Text>
        </Box>
      ) : null}
      {metrics.gasUsed ? (
        <Field label="gas" value={`${metrics.gasUsed} used / ${metrics.gasWanted ?? '?'} wanted`} />
      ) : null}
      {metrics.height ? <Field label="height" value={metrics.height} /> : null}
      {metrics.storageDelta ? <Field label="storage" value={`${metrics.storageDelta} bytes`} /> : null}
      {metrics.storageFee ? <Field label="storage fee" value={metrics.storageFee} /> : null}
      {metrics.totalTxCost ? (
        <Field label="total cost" value={formatCoins(metrics.totalTxCost)} valueColor={color.accent} />
      ) : null}
      {metrics.pkgPath ? <Field label="pkgpath" value={metrics.pkgPath} /> : null}
      {metrics.txHash ? <Field label="tx hash" value={<Text color={color.dim}>{metrics.txHash}</Text>} /> : null}
      {metrics.info ? <Field label="info" value={<Text color={color.muted}>{metrics.info}</Text>} /> : null}
    </Panel>
  );
}

/** A small repeatable input: add items one at a time, blank line to finish. */
function ListInput({
  label,
  onDone,
}: {
  label: string;
  onDone: (items: string[]) => void;
}): ReactNode {
  const [items, setItems] = useState<string[]>([]);
  const [gen, setGen] = useState(0);
  useInput((_i, key) => {
    if (key.escape) onDone(items);
  });
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Box key={i}>
          <Text color={color.accent}>{glyph.check} </Text>
          <Text color={color.dim}>
            arg {i}: {it}
          </Text>
        </Box>
      ))}
      <Box>
        <Text color={color.muted}>{label}: </Text>
        <TextInput
          key={gen}
          placeholder="(blank line to finish)"
          onSubmit={(v) => {
            if (v === '') onDone(items);
            else {
              setItems((prev) => [...prev, v]);
              setGen((g) => g + 1);
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={color.muted}>
          {items.length} arg{items.length === 1 ? '' : 's'} {glyph.dot} ⏎ add {glyph.dot} blank/esc
          finish
        </Text>
      </Box>
    </Box>
  );
}
