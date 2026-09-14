// Shared presentational components used across screens.
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { networkLabel, type Settings } from '../config.ts';
import { shortAddr, truncate } from '../format.ts';
import type { KeyInfo } from '../gnokey/types.ts';
import { color, glyph, keyTypeColor } from './theme.ts';

/** Top banner with product identity. */
export function Header({ subtitle }: { subtitle?: string }): ReactNode {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color.accent} bold>
          {glyph.logo} gnokey-tui
        </Text>
        <Text color={color.muted}>
          {'   '}
          {subtitle ?? 'a friendlier gnokey'}
        </Text>
      </Box>
      <Text color={color.accentDim}>{'─'.repeat(48)}</Text>
    </Box>
  );
}

/** Persistent context strip: network, chain, home, version, key count. */
export function StatusBar({
  settings,
  version,
  keyCount,
  acting,
}: {
  settings: Settings;
  version: string;
  keyCount: number;
  acting?: { address: string; name?: string; canSign: boolean; inKeybase: boolean };
}): ReactNode {
  const home = settings.home?.trim() ? shortHome(settings.home) : 'default home';
  const sep = <Text color={color.muted}> {glyph.dot} </Text>;
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={color.accentDim}>{'─'.repeat(48)}</Text>
      <Box>
        <Text color={color.accent}>{networkLabel(settings)}</Text>
        {sep}
        <Text color={color.dim}>{settings.chainId}</Text>
        {sep}
        <Text color={color.dim}>{settings.remote.replace(/^https?:\/\//, '')}</Text>
      </Box>
      <Box>
        <Text color={color.muted}>{home}</Text>
        {sep}
        <Text color={color.muted}>gnokey {version}</Text>
        {sep}
        <Text color={color.muted}>
          {keyCount} key{keyCount === 1 ? '' : 's'}
        </Text>
      </Box>
      {acting ? (
        <Box>
          <Text color={color.amber}>acting as </Text>
          <Text color={color.text}>{acting.name ?? shortAddr(acting.address)}</Text>
          <Text color={color.muted}>
            {' '}
            {acting.canSign
              ? '(signing key)'
              : acting.inKeybase
                ? '(watch-only)'
                : '(watch-only, not in keybase)'}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function shortHome(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
}

/** A titled bordered panel. */
export function Panel({
  title,
  children,
  borderColor = color.accentDim,
}: {
  title?: string;
  children: ReactNode;
  borderColor?: string;
}): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      {title ? (
        <Text color={color.accent} bold>
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

/** A label/value row with aligned labels. */
export function Field({
  label,
  value,
  labelWidth = 14,
  valueColor = color.text,
}: {
  label: string;
  value: ReactNode;
  labelWidth?: number;
  valueColor?: string;
}): ReactNode {
  return (
    <Box>
      <Box width={labelWidth}>
        <Text color={color.muted}>{label}</Text>
      </Box>
      {typeof value === 'string' ? (
        <Text color={valueColor}>{value}</Text>
      ) : (
        value
      )}
    </Box>
  );
}

/** Footer with keybinding hints. */
export function Hint({ items }: { items: string[] }): ReactNode {
  return (
    <Box marginTop={1}>
      <Text color={color.muted}>{items.join(`  ${glyph.dot}  `)}</Text>
    </Box>
  );
}

/** A colored type badge for a key. */
export function TypeBadge({ type }: { type: string }): ReactNode {
  return <Text color={keyTypeColor(type)}>{type}</Text>;
}

/** A table of keys, with an optional highlighted row. */
export function KeyTable({
  keys,
  selected,
  showPubkey = false,
}: {
  keys: KeyInfo[];
  selected?: number;
  showPubkey?: boolean;
}): ReactNode {
  if (keys.length === 0) {
    return <Text color={color.muted}>No keys in this keybase yet.</Text>;
  }
  const nameW = Math.min(
    Math.max(4, ...keys.map((k) => k.name.length)) + 1,
    20,
  );
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={3}>
          <Text color={color.muted}>#</Text>
        </Box>
        <Box width={nameW}>
          <Text color={color.muted}>name</Text>
        </Box>
        <Box width={9}>
          <Text color={color.muted}>type</Text>
        </Box>
        <Box width={18}>
          <Text color={color.muted}>address</Text>
        </Box>
        {showPubkey ? <Text color={color.muted}>pubkey</Text> : null}
      </Box>
      {keys.map((k, i) => {
        const isSel = i === selected;
        const marker = isSel ? glyph.arrow : ' ';
        return (
          <Box key={k.name}>
            <Box width={3}>
              <Text color={isSel ? color.accent : color.dim}>
                {marker}
                {k.index}
              </Text>
            </Box>
            <Box width={nameW}>
              <Text color={isSel ? color.accent : color.text} bold={isSel}>
                {truncate(k.name, nameW - 1)}
              </Text>
            </Box>
            <Box width={9}>
              <TypeBadge type={k.type} />
            </Box>
            <Box width={18}>
              <Text color={color.dim}>{shortAddr(k.address)}</Text>
            </Box>
            {showPubkey ? (
              <Text color={color.muted}>{truncate(k.pubkey, 28)}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

/** Show the exact gnokey command that will run. */
export function CommandPreview({ command }: { command: string }): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color.muted}
      paddingX={1}
    >
      <Text color={color.muted}>command</Text>
      <Text color={color.blue}>{command}</Text>
    </Box>
  );
}

/** Render query data: pretty JSON when possible, otherwise raw text. */
export function DataView({
  data,
  height,
}: {
  data: string;
  height?: number;
}): ReactNode {
  let body = data;
  let isJson = false;
  const trimmed = data.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      body = JSON.stringify(JSON.parse(trimmed), null, 2);
      isJson = true;
    } catch {
      /* leave as-is */
    }
  }
  return (
    <Box flexDirection="column">
      {height !== undefined ? (
        <Text color={color.muted}>height {height}</Text>
      ) : null}
      <Text color={isJson ? color.text : color.accent}>{body}</Text>
    </Box>
  );
}
