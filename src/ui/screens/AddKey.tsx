import type React from 'react';
import { Alert, ConfirmInput, Select, Spinner, StatusMessage } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { addKeyCmd, generateMnemonicCmd, run } from '../../gnokey/api.ts';
import { interactiveHeader, planPwCommand, resolveStrategy } from '../../gnokey/authexec.ts';
import { isErrorOutput, parseError } from '../../gnokey/parse.ts';
import { useApp } from '../context.tsx';
import { Header, Hint, Panel } from '../components.tsx';
import { PromptSequence, type Prompt } from '../PromptSequence.tsx';
import { color, glyph } from '../theme.ts';

interface FormVals {
  mnemonic?: string;
  password?: string;
}

type Mode =
  | { m: 'choose' }
  | { m: 'form'; recover: boolean }
  | { m: 'confirmOverwrite'; name: string; recover: boolean; vals: FormVals }
  | { m: 'busy'; label: string }
  | { m: 'result'; ok: boolean; output: string; isNew: boolean };

export function AddKeyScreen(): React.ReactNode {
  const { keys, settings, refreshKeys, nav, runInteractive } = useApp();
  const [mode, setMode] = useState<Mode>({ m: 'choose' });

  useInput((_i, key) => {
    if (key.escape) {
      if (mode.m === 'choose') nav.back();
      else if (mode.m === 'form' || mode.m === 'confirmOverwrite') setMode({ m: 'choose' });
    }
  });

  // Recover always enters a mnemonic, which the keychain can't supply, so it
  // never uses keychain mode.
  const strategyFor = (recover: boolean) =>
    recover
      ? resolveStrategy(settings, undefined, { noKeychain: true })
      : resolveStrategy(settings);

  async function doPipedAdd(bin: string, cmd: ReturnType<typeof addKeyCmd>, isNew: boolean) {
    setMode({ m: 'busy', label: isNew ? 'Creating key…' : 'Recovering key…' });
    try {
      const res = await run(bin, cmd);
      if (isErrorOutput(res.code, res.stderr)) {
        setMode({ m: 'result', ok: false, output: parseError(res.stderr, res.stdout), isNew });
      } else {
        setMode({ m: 'result', ok: true, output: res.stdout.trim() || 'Key created.', isNew });
        await refreshKeys();
      }
    } catch (err) {
      setMode({ m: 'result', ok: false, output: (err as Error).message, isNew });
    }
  }

  // Dispatch a key creation/recovery per the resolved strategy. The stdin lines
  // (passphrase, and mnemonic for recover) are only used by the stdin path; the
  // interactive and keychain paths strip them and let gnokey / gnokeykc supply
  // the secrets.
  function submit(name: string, recover: boolean, vals: FormVals, force: boolean) {
    const stdinCmd = addKeyCmd(settings, {
      name,
      mode: recover ? 'recover' : 'new',
      password: vals.password ?? '',
      mnemonic: vals.mnemonic,
      force,
    });
    const plan = planPwCommand(settings, { noKeychain: recover }, stdinCmd);

    if (plan.kind === 'interactive') {
      runInteractive(
        plan.args,
        interactiveHeader(
          `gnokey · add ${name}`,
          recover
            ? 'Enter your BIP39 mnemonic, then a passphrase.'
            : 'Enter a passphrase to encrypt the key. Save the mnemonic shown.',
        ),
        recover
          ? `Recovered key ${name}.`
          : `Created key ${name} — make sure you saved the mnemonic shown above.`,
      );
      return; // component unmounts
    }

    void doPipedAdd(plan.bin, plan.cmd, !recover);
  }

  async function doGenerate() {
    setMode({ m: 'busy', label: 'Generating mnemonic…' });
    try {
      const res = await run(settings.bin, generateMnemonicCmd(settings));
      if (isErrorOutput(res.code, res.stderr)) {
        setMode({ m: 'result', ok: false, output: parseError(res.stderr, res.stdout), isNew: false });
      } else {
        setMode({ m: 'result', ok: true, output: res.stdout.trim(), isNew: true });
      }
    } catch (err) {
      setMode({ m: 'result', ok: false, output: (err as Error).message, isNew: false });
    }
  }

  // ---- choose -----------------------------------------------------------
  if (mode.m === 'choose') {
    return (
      <Box flexDirection="column">
        <Header subtitle="add key" />
        <Text color={color.muted}>How do you want to add a key?</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: `${glyph.key} Create a new key (generates a mnemonic)`, value: 'new' },
              { label: `${glyph.arrow} Recover from an existing mnemonic`, value: 'recover' },
              { label: `${glyph.dot} Just generate a mnemonic (don't save)`, value: 'generate' },
              { label: `${glyph.arrow} Back`, value: 'back' },
            ]}
            onChange={(v) => {
              if (v === 'back') return nav.back();
              if (v === 'generate') return void doGenerate();
              setMode({ m: 'form', recover: v === 'recover' });
            }}
          />
        </Box>
        <Hint items={['⏎ select', 'esc back']} />
      </Box>
    );
  }

  // ---- form -------------------------------------------------------------
  if (mode.m === 'form') {
    const recover = mode.recover;
    const strategy = strategyFor(recover);
    const collectSecrets = strategy === 'stdin';
    const prompts: Prompt[] = [
      { key: 'name', label: 'Key name' },
      ...(recover && collectSecrets
        ? [{ key: 'mnemonic', label: 'BIP39 mnemonic (12 or 24 words)' } as Prompt]
        : []),
      ...(collectSecrets
        ? [
            { key: 'password', label: 'Passphrase to encrypt on disk', secret: true, optional: true } as Prompt,
            { key: 'password2', label: 'Repeat passphrase', secret: true, optional: true } as Prompt,
          ]
        : []),
    ];
    const note =
      strategy === 'interactive'
        ? recover
          ? 'gnokey will ask for the mnemonic and passphrase in the terminal.'
          : 'gnokey will ask for the passphrase in the terminal.'
        : strategy === 'keychain'
          ? 'the passphrase comes from the OS keychain (gnokeykc).'
          : 'An empty passphrase stores the key UNENCRYPTED — unsafe for on-chain use.';
    return (
      <Box flexDirection="column">
        <Header subtitle={recover ? 'recover key' : 'new key'} />
        <Text color={color.muted}>
          {glyph.dot} {note}
        </Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={prompts}
            onCancel={() => setMode({ m: 'choose' })}
            onDone={(vals) => {
              if (collectSecrets && (vals.password ?? '') !== (vals.password2 ?? '')) {
                setMode({ m: 'result', ok: false, output: "Passphrases don't match.", isNew: !recover });
                return;
              }
              const formVals: FormVals = { mnemonic: vals.mnemonic, password: vals.password };
              if (keys.some((k) => k.name === vals.name)) {
                setMode({ m: 'confirmOverwrite', name: vals.name, recover, vals: formVals });
                return;
              }
              submit(vals.name, recover, formVals, false);
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---- confirm overwrite ------------------------------------------------
  if (mode.m === 'confirmOverwrite') {
    return (
      <Box flexDirection="column">
        <Header subtitle="add key" />
        <Alert variant="warning">
          A key named "{mode.name}" already exists. Overwrite it?
        </Alert>
        <Box marginTop={1}>
          <Text color={color.muted}>Overwrite? </Text>
          <ConfirmInput
            onConfirm={() => submit(mode.name, mode.recover, mode.vals, true)}
            onCancel={() => setMode({ m: 'choose' })}
          />
        </Box>
      </Box>
    );
  }

  // ---- busy -------------------------------------------------------------
  if (mode.m === 'busy') {
    return (
      <Box flexDirection="column">
        <Header subtitle="add key" />
        <Spinner label={mode.label} />
      </Box>
    );
  }

  // ---- result -----------------------------------------------------------
  return (
    <Box flexDirection="column">
      <Header subtitle="add key" />
      {mode.ok && mode.isNew ? (
        <Alert variant="warning">
          {glyph.warn} Write the mnemonic below down and store it safely. It is the only
          way to recover this key.
        </Alert>
      ) : null}
      <Box marginTop={1}>
        {mode.ok ? (
          <Panel title="result" borderColor={color.accentDim}>
            <Text>{mode.output}</Text>
          </Panel>
        ) : (
          <StatusMessage variant="error">{mode.output}</StatusMessage>
        )}
      </Box>
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'Add another', value: 'again' },
            { label: 'Back to menu', value: 'menu' },
          ]}
          onChange={(v) => (v === 'again' ? setMode({ m: 'choose' }) : nav.back())}
        />
      </Box>
    </Box>
  );
}
