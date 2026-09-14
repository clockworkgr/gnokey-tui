import type React from 'react';
import { Select, Spinner, StatusMessage } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import { query } from '../../gnokey/api.ts';
import { parseGasPrice } from '../../gnokey/parse.ts';
import { formatCoins } from '../../format.ts';
import { useApp } from '../context.tsx';
import { CommandPreview, DataView, Field, Header, Hint, Panel } from '../components.tsx';
import { PromptSequence, type Prompt } from '../PromptSequence.tsx';
import { color, glyph } from '../theme.ts';
import { previewCmd, queryCmd } from '../../gnokey/api.ts';

interface QSpec {
  id: string;
  label: string;
  prompts: Prompt[];
  build: (v: Record<string, string>) => { path: string; data?: string };
  /** Optional custom renderer for the data payload. */
  format?: (data: string) => ReactNode;
}

const SPECS: QSpec[] = [
  {
    id: 'render',
    label: 'Realm render — vm/qrender',
    prompts: [
      { key: 'pkg', label: 'Package path', placeholder: 'gno.land/r/gnoland/home' },
      { key: 'path', label: 'Render path', optional: true, placeholder: '(empty = default)' },
    ],
    build: (v) => ({ path: 'vm/qrender', data: `${v.pkg}:${v.path ?? ''}` }),
    format: (d) => <Text color={color.text}>{d}</Text>,
  },
  {
    id: 'qeval',
    label: 'Evaluate expression — vm/qeval',
    prompts: [
      { key: 'pkg', label: 'Package path', placeholder: 'gno.land/r/gnoland/wugnot' },
      { key: 'expr', label: 'Expression', placeholder: 'BalanceOf("g1...")' },
    ],
    build: (v) => ({ path: 'vm/qeval', data: `${v.pkg}.${v.expr}` }),
  },
  {
    id: 'qfuncs',
    label: 'Exported functions — vm/qfuncs',
    prompts: [{ key: 'pkg', label: 'Package path' }],
    build: (v) => ({ path: 'vm/qfuncs', data: v.pkg }),
    format: (d) => <FuncList data={d} />,
  },
  {
    id: 'qfile',
    label: 'Files / source — vm/qfile',
    prompts: [{ key: 'pkg', label: 'Package path (add /file.gno for source)' }],
    build: (v) => ({ path: 'vm/qfile', data: v.pkg }),
    format: (d) => <Text color={color.text}>{d}</Text>,
  },
  {
    id: 'qdoc',
    label: 'Documentation — vm/qdoc',
    prompts: [{ key: 'pkg', label: 'Package path' }],
    build: (v) => ({ path: 'vm/qdoc', data: v.pkg }),
  },
  {
    id: 'qpaths',
    label: 'List package paths — vm/qpaths',
    prompts: [{ key: 'prefix', label: 'Path prefix or @user', optional: true }],
    build: (v) => ({ path: 'vm/qpaths', data: v.prefix ?? '' }),
    format: (d) => <Text color={color.accent}>{d}</Text>,
  },
  {
    id: 'qstorage',
    label: 'Storage usage — vm/qstorage',
    prompts: [{ key: 'pkg', label: 'Realm path' }],
    build: (v) => ({ path: 'vm/qstorage', data: v.pkg }),
    format: (d) => <Text color={color.text}>{d}</Text>,
  },
  {
    id: 'account',
    label: 'Account — auth/accounts',
    prompts: [{ key: 'addr', label: 'Address' }],
    build: (v) => ({ path: `auth/accounts/${v.addr}` }),
  },
  {
    id: 'balance',
    label: 'Balance — bank/balances',
    prompts: [{ key: 'addr', label: 'Address' }],
    build: (v) => ({ path: `bank/balances/${v.addr}` }),
    format: (d) => <Text color={color.accent}>{formatCoins(d.replace(/^"|"$/g, ''))}</Text>,
  },
  {
    id: 'supply',
    label: 'Total supply — bank/supply',
    prompts: [{ key: 'denom', label: 'Denomination', initial: 'ugnot' }],
    build: (v) => ({ path: `bank/supply/${v.denom}` }),
  },
  {
    id: 'gasprice',
    label: 'Gas price — auth/gasprice',
    prompts: [],
    build: () => ({ path: 'auth/gasprice' }),
    format: (d) => <GasPriceView data={d} />,
  },
  {
    id: 'raw',
    label: 'Raw query (any path)',
    prompts: [
      { key: 'path', label: 'Query path', placeholder: 'vm/qrender' },
      { key: 'data', label: 'Data', optional: true },
    ],
    build: (v) => ({ path: v.path, data: v.data }),
  },
];

type Mode =
  | { m: 'menu' }
  | { m: 'input'; spec: QSpec }
  | { m: 'busy'; spec: QSpec; command: string }
  | { m: 'result'; spec: QSpec; ok: boolean; data: string; height: number; command: string };

export function QueryScreen(): React.ReactNode {
  const { settings, nav } = useApp();
  const [mode, setMode] = useState<Mode>({ m: 'menu' });

  useInput((_i, key) => {
    if (key.escape) {
      if (mode.m === 'menu') nav.back();
      else setMode({ m: 'menu' });
    }
  });

  async function runQuery(spec: QSpec, vals: Record<string, string>) {
    const { path, data } = spec.build(vals);
    const command = previewCmd(settings.bin, queryCmd(settings, path, { data }));
    setMode({ m: 'busy', spec, command });
    try {
      const res = await query(settings, path, { data });
      setMode({ m: 'result', spec, ok: true, data: res.data, height: res.height, command });
    } catch (err) {
      setMode({ m: 'result', spec, ok: false, data: (err as Error).message, height: 0, command });
    }
  }

  if (mode.m === 'menu') {
    return (
      <Box flexDirection="column">
        <Header subtitle="query state" />
        <Text color={color.muted}>Read on-chain state (no gas, no signing).</Text>
        <Box marginTop={1}>
          <Select
            visibleOptionCount={SPECS.length + 1}
            options={[
              ...SPECS.map((s) => ({ label: s.label, value: s.id })),
              { label: `${glyph.arrow} Back`, value: 'back' },
            ]}
            onChange={(v) => {
              if (v === 'back') return nav.back();
              const spec = SPECS.find((s) => s.id === v)!;
              if (spec.prompts.length === 0) void runQuery(spec, {});
              else setMode({ m: 'input', spec });
            }}
          />
        </Box>
        <Hint items={['↑↓ move', '⏎ select', 'esc back']} />
      </Box>
    );
  }

  if (mode.m === 'input') {
    return (
      <Box flexDirection="column">
        <Header subtitle="query" />
        <Text color={color.accent}>{mode.spec.label}</Text>
        <Box marginTop={1}>
          <PromptSequence
            prompts={mode.spec.prompts}
            onCancel={() => setMode({ m: 'menu' })}
            onDone={(vals) => void runQuery(mode.spec, vals)}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'busy') {
    return (
      <Box flexDirection="column">
        <Header subtitle="query" />
        <CommandPreview command={mode.command} />
        <Box marginTop={1}>
          <Spinner label="Querying…" />
        </Box>
      </Box>
    );
  }

  // result
  return (
    <Box flexDirection="column">
      <Header subtitle="query" />
      <CommandPreview command={mode.command} />
      <Box marginTop={1}>
        {mode.ok ? (
          <Panel title={mode.spec.label}>
            {mode.spec.format ? (
              <Box flexDirection="column">
                <Text color={color.muted}>height {mode.height}</Text>
                {mode.spec.format(mode.data)}
              </Box>
            ) : (
              <DataView data={mode.data} height={mode.height} />
            )}
          </Panel>
        ) : (
          <StatusMessage variant="error">{mode.data}</StatusMessage>
        )}
      </Box>
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'New query', value: 'again' },
            { label: 'Back to menu', value: 'menu' },
          ]}
          onChange={(v) => (v === 'again' ? setMode({ m: 'menu' }) : nav.back())}
        />
      </Box>
    </Box>
  );
}

function GasPriceView({ data }: { data: string }): ReactNode {
  const gp = parseGasPrice(data);
  if (!gp) return <DataView data={data} />;
  return (
    <Box flexDirection="column">
      <Field label="gas" value={gp.gas} />
      <Field label="price" value={gp.price} />
      <Field label="rate" value={`${gp.price} per ${gp.gas} gas`} valueColor={color.accent} />
    </Box>
  );
}

function FuncList({ data }: { data: string }): ReactNode {
  try {
    const funcs = JSON.parse(data) as Array<{
      FuncName: string;
      Params: Array<{ Name: string; Type: string }> | null;
      Results: Array<{ Name: string; Type: string }> | null;
    }>;
    return (
      <Box flexDirection="column">
        {funcs.map((f) => {
          const params = (f.Params ?? [])
            .filter((p) => !p.Type.startsWith('interface {')) // hide the `cur realm` receiver
            .map((p) => `${p.Name} ${p.Type}`)
            .join(', ');
          const results = (f.Results ?? []).map((r) => r.Type).join(', ');
          return (
            <Box key={f.FuncName}>
              <Text color={color.accent}>{f.FuncName}</Text>
              <Text color={color.dim}>({params})</Text>
              {results ? <Text color={color.muted}> {glyph.arrow} {results}</Text> : null}
            </Box>
          );
        })}
      </Box>
    );
  } catch {
    return <DataView data={data} />;
  }
}
