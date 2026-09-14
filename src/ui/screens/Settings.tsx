import type React from 'react';
import { Select } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import {
  NETWORKS,
  PASSWORD_SOURCES,
  networkLabel,
  passwordSourceLabel,
  settingsConfigPath,
  type PasswordSource,
} from '../../config.ts';
import { truncate } from '../../format.ts';
import { useApp } from '../context.tsx';
import { Field, Header, Hint, Panel } from '../components.tsx';
import { PromptSequence } from '../PromptSequence.tsx';
import { color, glyph } from '../theme.ts';

type EditKey = 'remote' | 'chainId' | 'home' | 'bin' | 'kcBin';

type Mode =
  | { m: 'menu' }
  | { m: 'network' }
  | { m: 'password' }
  | { m: 'edit'; field: EditKey };

const EDIT_LABEL: Record<EditKey, string> = {
  remote: 'RPC remote URL',
  chainId: 'Chain ID',
  home: 'gnokey home directory (blank = default)',
  bin: 'gnokey binary path',
  kcBin: 'keychain binary path (gnokeykc)',
};

export function SettingsScreen(): React.ReactNode {
  const { settings, setSettings, nav } = useApp();
  const [mode, setMode] = useState<Mode>({ m: 'menu' });

  useInput((_i, key) => {
    if (key.escape) {
      if (mode.m === 'menu') nav.back();
      else setMode({ m: 'menu' });
    }
  });

  if (mode.m === 'network') {
    return (
      <Box flexDirection="column">
        <Header subtitle="settings · network" />
        <Text color={color.muted}>Pick a preset (sets remote + chain id):</Text>
        <Box marginTop={1}>
          <Select
            options={[
              ...NETWORKS.map((n) => ({ label: n.label, value: n.id })),
              { label: `${glyph.arrow} Back`, value: '__back' },
            ]}
            onChange={(v) => {
              if (v === '__back') return setMode({ m: 'menu' });
              const net = NETWORKS.find((n) => n.id === v)!;
              setSettings({ ...settings, remote: net.remote, chainId: net.chainId });
              setMode({ m: 'menu' });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'password') {
    return (
      <Box flexDirection="column">
        <Header subtitle="settings · password handling" />
        <Text color={color.muted}>How should key passwords reach gnokey?</Text>
        <Box marginTop={1}>
          <Select
            visibleOptionCount={PASSWORD_SOURCES.length + 1}
            options={[
              ...PASSWORD_SOURCES.map((p) => ({ label: p.label, value: p.value })),
              { label: `${glyph.arrow} Back`, value: '__back' },
            ]}
            onChange={(v) => {
              if (v === '__back') return setMode({ m: 'menu' });
              setSettings({ ...settings, passwordSource: v as PasswordSource });
              setMode({ m: 'menu' });
            }}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          {PASSWORD_SOURCES.map((p) => (
            <Text key={p.value} color={color.muted}>
              <Text color={color.accent}>{p.label}</Text>: {p.blurb}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (mode.m === 'edit') {
    const field = mode.field;
    return (
      <Box flexDirection="column">
        <Header subtitle="settings" />
        <PromptSequence
          prompts={[
            {
              key: 'value',
              label: EDIT_LABEL[field],
              initial: settings[field],
              optional: field === 'home',
            },
          ]}
          onCancel={() => setMode({ m: 'menu' })}
          onDone={(vals) => {
            setSettings({ ...settings, [field]: vals.value ?? '' });
            setMode({ m: 'menu' });
          }}
        />
      </Box>
    );
  }

  // menu
  return (
    <Box flexDirection="column">
      <Header subtitle="settings" />
      <Panel title="current">
        <Field label="network" value={networkLabel(settings)} valueColor={color.accent} />
        <Field label="remote" value={settings.remote} />
        <Field label="chain id" value={settings.chainId} />
        <Field
          label="home"
          value={settings.home ? truncate(settings.home, 52) : '(gnokey default)'}
        />
        <Field label="gnokey" value={settings.bin} />
        <Field
          label="password"
          value={passwordSourceLabel(settings)}
          valueColor={settings.passwordSource === 'stdin' ? color.amber : color.accent}
        />
        {settings.passwordSource === 'keychain' ? (
          <Field label="keychain bin" value={settings.kcBin} />
        ) : null}
      </Panel>
      <Box marginTop={1}>
        <Select
          options={[
            { label: `${glyph.arrow} Choose network preset`, value: 'network' },
            { label: `${glyph.key} Password handling`, value: 'password' },
            { label: `${glyph.dot} Edit remote URL`, value: 'remote' },
            { label: `${glyph.dot} Edit chain ID`, value: 'chainId' },
            { label: `${glyph.dot} Edit home directory`, value: 'home' },
            { label: `${glyph.dot} Edit gnokey binary path`, value: 'bin' },
            { label: `${glyph.dot} Edit keychain binary path`, value: 'kcBin' },
            { label: `${glyph.arrow} Back`, value: 'back' },
          ]}
          visibleOptionCount={8}
          onChange={(v) => {
            if (v === 'back') return nav.back();
            if (v === 'network') return setMode({ m: 'network' });
            if (v === 'password') return setMode({ m: 'password' });
            setMode({ m: 'edit', field: v as EditKey });
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={color.muted}>saved to {settingsConfigPath()}</Text>
      </Box>
      <Hint items={['⏎ select', 'esc back', 'changes save immediately']} />
    </Box>
  );
}
