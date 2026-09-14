import type React from 'react';
import { Select, StatusMessage } from '@inkjs/ui';
import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useApp } from '../context.tsx';
import { Header, Hint, StatusBar } from '../components.tsx';
import { color, glyph } from '../theme.ts';

interface MenuItem {
  label: string;
  value: string;
  hint: string;
}

const MENU: MenuItem[] = [
  { label: `${glyph.key}  Keys`, value: 'keys', hint: 'list, add, delete, export' },
  { label: `${glyph.arrow}  Query state`, value: 'query', hint: 'render, funcs, files, eval' },
  { label: `${glyph.coin}  Account overview`, value: 'account', hint: 'balance, number, sequence' },
  { label: `${glyph.arrow}  Send tokens`, value: 'tx:send', hint: 'transfer ugnot' },
  { label: `${glyph.arrow}  Call a realm`, value: 'tx:call', hint: 'maketx call' },
  { label: `${glyph.arrow}  Run a script`, value: 'tx:run', hint: 'maketx run' },
  { label: `${glyph.arrow}  Deploy a package`, value: 'tx:addpkg', hint: 'maketx addpkg' },
  { label: `${glyph.dot}  Settings`, value: 'settings', hint: 'network, chain, home' },
  { label: `${glyph.dot}  About`, value: 'about', hint: 'version & links' },
  { label: `${glyph.cross}  Quit`, value: 'quit', hint: '' },
];

export function Home(): React.ReactNode {
  const { nav, settings, version, keys, acting, flash, clearFlash } = useApp();
  const { exit } = useInkApp();

  useInput((input) => {
    if (input === 'q' || input === 'Q') exit();
  });

  const onChange = (value: string) => {
    clearFlash();
    if (value === 'quit') return exit();
    if (value.startsWith('tx:')) {
      nav.go('tx', { kind: value.slice(3) });
      return;
    }
    nav.go(value);
  };

  return (
    <Box flexDirection="column">
      <Header />
      {flash ? (
        <Box marginBottom={1}>
          <StatusMessage variant="success">{flash}</StatusMessage>
        </Box>
      ) : null}
      <Text color={color.muted}>What would you like to do?</Text>
      <Box marginTop={1}>
        <Select
          options={MENU.map(({ label, value }) => ({ label, value }))}
          visibleOptionCount={MENU.length}
          onChange={onChange}
        />
      </Box>
      <StatusBar
        settings={settings}
        version={version}
        keyCount={keys.length}
        acting={acting}
      />
      <Hint items={['↑↓ move', '⏎ select', 'q quit']} />
    </Box>
  );
}
