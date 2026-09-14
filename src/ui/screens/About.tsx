import type React from 'react';
import { Select } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { settingsConfigPath } from '../../config.ts';
import { useApp } from '../context.tsx';
import { Field, Header, Panel } from '../components.tsx';
import { color, glyph } from '../theme.ts';

const LINKS: Array<[string, string]> = [
  ['Docs', 'https://docs.gno.land'],
  ['Explorer', 'https://gnoscan.io'],
  ['Faucet', 'https://faucet.gno.land'],
  ['Playground', 'https://play.gno.land'],
];

export function AboutScreen(): React.ReactNode {
  const { version, nav } = useApp();

  useInput((_i, key) => {
    if (key.escape) nav.back();
  });

  return (
    <Box flexDirection="column">
      <Header subtitle="about" />
      <Panel title="gnokey-tui">
        <Text color={color.muted}>
          A friendlier terminal UI that wraps the gnokey binary. Every action runs a
          real gnokey command; nothing here re-implements signing or crypto.
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Field label="tui version" value="0.1.0" />
          <Field label="gnokey" value={version} />
          <Field label="settings" value={settingsConfigPath()} />
        </Box>
      </Panel>
      <Box marginTop={1}>
        <Panel title="security" borderColor={color.amber}>
          <Text color={color.text}>
            {glyph.warn} Key passwords are handled per the Password setting. By default
            (<Text color={color.accent}>Prompt in terminal</Text>) gnokey-tui suspends and
            lets gnokey ask for the password itself, so it never enters this tool.
            <Text color={color.accent}> OS keychain</Text> reads it from gnokeykc. Only
            <Text color={color.amber}> Send via stdin</Text> pipes the password through
            gnokey-tui, and is meant for scripting on a trusted machine. Ledger keys sign
            on-device. Change this under Settings › Password handling.
          </Text>
        </Panel>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={color.muted}>links</Text>
        {LINKS.map(([label, url]) => (
          <Box key={label}>
            <Box width={12}>
              <Text color={color.muted}>{label}</Text>
            </Box>
            <Text color={color.blue}>{url}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Select options={[{ label: 'Back', value: 'back' }]} onChange={() => nav.back()} />
      </Box>
    </Box>
  );
}
