import type React from 'react';
import { Alert, Select, Spinner, StatusMessage } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { deleteKeyCmd, exportKeyCmd, importKeyCmd, run, type Cmd } from '../../gnokey/api.ts';
import {
  interactiveHeader,
  needsInAppPassword,
  planPwCommand,
  pwModeNote,
} from '../../gnokey/authexec.ts';
import { isErrorOutput, parseError } from '../../gnokey/parse.ts';
import type { KeyInfo } from '../../gnokey/types.ts';
import { useApp } from '../context.tsx';
import { Field, Header, Hint, KeyTable, Panel, TypeBadge } from '../components.tsx';
import { PromptSequence, type Prompt } from '../PromptSequence.tsx';
import { color, glyph } from '../theme.ts';

type Mode =
  | { m: 'list' }
  | { m: 'detail'; key: KeyInfo }
  | { m: 'delete'; key: KeyInfo }
  | { m: 'export'; key: KeyInfo }
  | { m: 'import' }
  | { m: 'busy'; label: string }
  | { m: 'result'; ok: boolean; message: string };

export function KeysScreen(): React.ReactNode {
  const { keys, keysLoading, keysError, refreshKeys, settings, nav, runInteractive } =
    useApp();
  const [mode, setMode] = useState<Mode>({ m: 'list' });

  useInput((_i, key) => {
    if (key.escape) {
      if (mode.m === 'list') nav.back();
      else setMode({ m: 'list' });
    }
  });

  // Run a command in-app (piped) and show its result.
  async function execRun(bin: string, label: string, cmd: Cmd) {
    setMode({ m: 'busy', label });
    try {
      const res = await run(bin, cmd);
      if (isErrorOutput(res.code, res.stderr)) {
        setMode({ m: 'result', ok: false, message: parseError(res.stderr, res.stdout) });
      } else {
        const out = (res.stdout + res.stderr).trim();
        setMode({ m: 'result', ok: true, message: out || 'Done.' });
        await refreshKeys();
      }
    } catch (err) {
      setMode({ m: 'result', ok: false, message: (err as Error).message });
    }
  }

  // Run a password-requiring command per the configured strategy. `stdinCmd`
  // must already carry -insecure-password-stdin and its stdin lines (used only
  // for the stdin strategy); planPwCommand strips them for the other paths.
  function runPwCommand(opts: {
    keyType?: string;
    noKeychain?: boolean;
    stdinCmd: Cmd;
    header: string;
    flash: string;
    busyLabel: string;
  }) {
    const plan = planPwCommand(
      settings,
      { keyType: opts.keyType, noKeychain: opts.noKeychain },
      opts.stdinCmd,
    );
    if (plan.kind === 'interactive') {
      runInteractive(plan.args, opts.header, opts.flash);
      return; // component unmounts
    }
    void execRun(plan.bin, opts.busyLabel, plan.cmd);
  }

  // ---- list -------------------------------------------------------------
  if (mode.m === 'list') {
    const options = [
      ...keys.map((k) => ({ label: `${k.name}  (${k.type})`, value: `key:${k.name}` })),
      { label: `${glyph.check} Add a new key`, value: 'add' },
      { label: `${glyph.arrow} Import from armor file`, value: 'import' },
      { label: `${glyph.dot} Refresh`, value: 'refresh' },
      { label: `${glyph.arrow} Back`, value: 'back' },
    ];
    return (
      <Box flexDirection="column">
        <Header subtitle="keys" />
        {keysError ? <Alert variant="error">{keysError}</Alert> : null}
        <Panel title="keybase">
          {keysLoading ? <Spinner label="Loading keys…" /> : <KeyTable keys={keys} />}
        </Panel>
        <Box marginTop={1} flexDirection="column">
          <Text color={color.muted}>Select a key, or an action:</Text>
          <Select
            visibleOptionCount={Math.min(options.length, 12)}
            options={options}
            onChange={(v) => {
              if (v === 'back') return nav.back();
              if (v === 'refresh') return void refreshKeys();
              if (v === 'add') return nav.go('addkey');
              if (v === 'import') return setMode({ m: 'import' });
              const name = v.slice(4);
              const k = keys.find((x) => x.name === name);
              if (k) setMode({ m: 'detail', key: k });
            }}
          />
        </Box>
        <Hint items={['↑↓ move', '⏎ open', 'esc back']} />
      </Box>
    );
  }

  // ---- detail -----------------------------------------------------------
  if (mode.m === 'detail') {
    const k = mode.key;
    return (
      <Box flexDirection="column">
        <Header subtitle={`key · ${k.name}`} />
        <Panel title={k.name}>
          <Field label="type" value={<TypeBadge type={k.type} />} />
          <Field label="address" value={k.address} />
          <Field label="pubkey" value={<Text color={color.dim}>{k.pubkey}</Text>} />
          <Field label="path" value={k.path ?? '<nil>'} />
          <Field
            label="signing"
            value={
              <Text color={k.canSign ? color.accent : color.muted}>
                {k.canSign ? 'yes — can sign transactions' : 'no — reference only'}
              </Text>
            }
          />
        </Panel>
        <Box marginTop={1}>
          <Select
            options={[
              { label: `${glyph.coin} Account overview`, value: 'account' },
              ...(k.canSign
                ? [{ label: `${glyph.arrow} Export to armor file`, value: 'export' }]
                : []),
              { label: `${glyph.cross} Delete`, value: 'delete' },
              { label: `${glyph.arrow} Back`, value: 'back' },
            ]}
            onChange={(v) => {
              if (v === 'back') return setMode({ m: 'list' });
              if (v === 'account')
                return nav.go('account', { address: k.address, name: k.name });
              if (v === 'export') return setMode({ m: 'export', key: k });
              if (v === 'delete') return setMode({ m: 'delete', key: k });
            }}
          />
        </Box>
        <Hint items={['⏎ select', 'esc back']} />
      </Box>
    );
  }

  // ---- delete -----------------------------------------------------------
  if (mode.m === 'delete') {
    const k = mode.key;
    const isRef = k.type === 'offline' || k.type === 'ledger';
    const stdinPw = !isRef && needsInAppPassword(settings, k.type);
    const prompts: Prompt[] = [
      { key: 'confirm', label: `Type the key name "${k.name}" to confirm deletion` },
      ...(stdinPw
        ? [{ key: 'password', label: 'Password to decrypt key', secret: true } as Prompt]
        : []),
    ];
    return (
      <Box flexDirection="column">
        <Header subtitle={`delete · ${k.name}`} />
        <Alert variant="warning">
          Deleting a signing key is irreversible without its mnemonic.
        </Alert>
        {!isRef ? (
          <Text color={color.muted}>{glyph.dot} {pwModeNote(settings, k.type)}</Text>
        ) : null}
        <Box marginTop={1}>
          <PromptSequence
            prompts={prompts}
            onCancel={() => setMode({ m: 'detail', key: k })}
            onDone={(vals) => {
              if (vals.confirm !== k.name) {
                setMode({ m: 'result', ok: false, message: 'Name did not match; aborted.' });
                return;
              }
              if (isRef) {
                void execRun(
                  settings.bin,
                  `Deleting ${k.name}…`,
                  deleteKeyCmd(settings, { name: k.name, reference: true }),
                );
                return;
              }
              runPwCommand({
                keyType: k.type,
                stdinCmd: deleteKeyCmd(settings, { name: k.name, password: vals.password ?? '' }),
                header: interactiveHeader(`gnokey · delete ${k.name}`, 'Enter the key password to confirm.'),
                flash: `Deleted key ${k.name}.`,
                busyLabel: `Deleting ${k.name}…`,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---- export -----------------------------------------------------------
  if (mode.m === 'export') {
    const k = mode.key;
    const stdinSecrets = needsInAppPassword(settings, k.type);
    const prompts: Prompt[] = [
      { key: 'outputPath', label: 'Output file path', placeholder: './key.armor' },
      ...(stdinSecrets
        ? [
            { key: 'decryptPass', label: 'Password to decrypt key from disk', secret: true },
            { key: 'armorPass', label: 'New passphrase to encrypt the armor', secret: true },
          ]
        : []),
    ];
    return (
      <Box flexDirection="column">
        <Header subtitle={`export · ${k.name}`} />
        <Text color={color.muted}>
          Writes an encrypted armor file you can back up or import elsewhere.
        </Text>
        <Text color={color.muted}>{glyph.dot} {pwModeNote(settings, k.type)}</Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={prompts}
            onCancel={() => setMode({ m: 'detail', key: k })}
            onDone={(vals) => {
              runPwCommand({
                keyType: k.type,
                stdinCmd: exportKeyCmd(settings, {
                  name: k.name,
                  outputPath: vals.outputPath,
                  decryptPass: vals.decryptPass ?? '',
                  armorPass: vals.armorPass ?? '',
                }),
                header: interactiveHeader(`gnokey · export ${k.name}`, 'Enter the decrypt and armor passphrases.'),
                flash: `Exported ${k.name} to ${vals.outputPath}.`,
                busyLabel: `Exporting ${k.name}…`,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---- import -----------------------------------------------------------
  if (mode.m === 'import') {
    // Import's armor password is external, so it never uses the shared keychain.
    const stdinSecrets = needsInAppPassword(settings, undefined, { noKeychain: true });
    const prompts: Prompt[] = [
      { key: 'name', label: 'New key name' },
      { key: 'armorPath', label: 'Path to armor file', placeholder: './key.armor' },
      ...(stdinSecrets
        ? [
            { key: 'armorPass', label: 'Passphrase to decrypt the armor', secret: true },
            { key: 'encryptPass', label: 'Passphrase to encrypt on disk', secret: true },
          ]
        : []),
    ];
    return (
      <Box flexDirection="column">
        <Header subtitle="import key" />
        <Text color={color.muted}>
          {glyph.dot} {pwModeNote(settings, undefined, { noKeychain: true })}
        </Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={prompts}
            onCancel={() => setMode({ m: 'list' })}
            onDone={(vals) => {
              runPwCommand({
                noKeychain: true,
                stdinCmd: importKeyCmd(settings, {
                  name: vals.name,
                  armorPath: vals.armorPath,
                  armorPass: vals.armorPass ?? '',
                  encryptPass: vals.encryptPass ?? '',
                }),
                header: interactiveHeader(`gnokey · import ${vals.name}`, 'Enter the armor and new disk passphrases.'),
                flash: `Imported key ${vals.name}.`,
                busyLabel: `Importing ${vals.name}…`,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  // ---- busy -------------------------------------------------------------
  if (mode.m === 'busy') {
    return (
      <Box flexDirection="column">
        <Header subtitle="keys" />
        <Spinner label={mode.label} />
      </Box>
    );
  }

  // ---- result -----------------------------------------------------------
  return (
    <Box flexDirection="column">
      <Header subtitle="keys" />
      <StatusMessage variant={mode.ok ? 'success' : 'error'}>{mode.message}</StatusMessage>
      <Box marginTop={1}>
        <Select
          options={[{ label: 'Back to keys', value: 'ok' }]}
          onChange={() => setMode({ m: 'list' })}
        />
      </Box>
    </Box>
  );
}
