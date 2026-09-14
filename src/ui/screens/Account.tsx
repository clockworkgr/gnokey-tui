import type React from 'react';
import { Select, Spinner, StatusMessage } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { getAccount, getBalance, getGasPrice } from '../../gnokey/api.ts';
import type { AccountInfo, GasPrice } from '../../gnokey/types.ts';
import { formatCoins } from '../../format.ts';
import { useApp } from '../context.tsx';
import { Field, Header, Hint, Panel } from '../components.tsx';
import { PromptSequence } from '../PromptSequence.tsx';
import { color, glyph } from '../theme.ts';

interface Params {
  address?: string;
  name?: string;
}

interface Loaded {
  balance: string;
  account: AccountInfo | null;
  accountError?: string;
  gasPrice: GasPrice | null;
}

type Mode =
  | { m: 'pick' }
  | { m: 'manual' }
  | { m: 'loading'; address: string; name?: string }
  | { m: 'shown'; address: string; name?: string; data: Loaded }
  | { m: 'error'; message: string };

export function AccountScreen({ params }: { params?: Record<string, unknown> }): React.ReactNode {
  const p = (params ?? {}) as Params;
  const { keys, settings, nav, acting } = useApp();
  const [mode, setMode] = useState<Mode>(() => {
    if (p.address) return { m: 'loading', address: p.address, name: p.name };
    if (acting) return { m: 'loading', address: acting.address, name: acting.name };
    return { m: 'pick' };
  });

  useInput((_i, key) => {
    if (key.escape) {
      if (mode.m === 'pick') nav.back();
      else if (mode.m === 'manual') setMode({ m: 'pick' });
      else setMode({ m: 'pick' });
    }
  });

  useEffect(() => {
    if (mode.m !== 'loading') return;
    let cancelled = false;
    const addr = mode.address;
    (async () => {
      try {
        const [balance, account, gasPrice] = await Promise.all([
          getBalance(settings, addr).catch(() => ''),
          getAccount(settings, addr).catch((e: Error) => {
            throw e;
          }),
          getGasPrice(settings).catch(() => null),
        ]);
        if (!cancelled)
          setMode({
            m: 'shown',
            address: addr,
            name: mode.name,
            data: { balance, account, gasPrice },
          });
      } catch (err) {
        // Account query failed (often "account is not initialized" for a fresh
        // address). Still show the balance and gas price.
        const balance = await getBalance(settings, addr).catch(() => '');
        const gasPrice = await getGasPrice(settings).catch(() => null);
        if (!cancelled)
          setMode({
            m: 'shown',
            address: addr,
            name: mode.name,
            data: { balance, account: null, accountError: (err as Error).message, gasPrice },
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, settings]);

  if (mode.m === 'pick') {
    const options = [
      ...keys.map((k) => ({ label: `${k.name}  ${glyph.dot}  ${k.address}`, value: k.address })),
      { label: `${glyph.arrow} Enter an address manually`, value: '__manual' },
      { label: `${glyph.arrow} Back`, value: '__back' },
    ];
    return (
      <Box flexDirection="column">
        <Header subtitle="account" />
        <Text color={color.muted}>Whose account?</Text>
        <Box marginTop={1}>
          <Select
            visibleOptionCount={Math.min(options.length, 12)}
            options={options}
            onChange={(v) => {
              if (v === '__back') return nav.back();
              if (v === '__manual') return setMode({ m: 'manual' });
              const k = keys.find((x) => x.address === v);
              setMode({ m: 'loading', address: v, name: k?.name });
            }}
          />
        </Box>
        <Hint items={['↑↓ move', '⏎ select', 'esc back']} />
      </Box>
    );
  }

  if (mode.m === 'manual') {
    return (
      <Box flexDirection="column">
        <Header subtitle="account" />
        <PromptSequence
          prompts={[{ key: 'address', label: 'Address (g1…)' }]}
          onCancel={() => setMode({ m: 'pick' })}
          onDone={(v) => setMode({ m: 'loading', address: v.address })}
        />
      </Box>
    );
  }

  if (mode.m === 'loading') {
    return (
      <Box flexDirection="column">
        <Header subtitle="account" />
        <Spinner label={`Loading ${mode.name ?? mode.address}…`} />
      </Box>
    );
  }

  if (mode.m === 'error') {
    return (
      <Box flexDirection="column">
        <Header subtitle="account" />
        <StatusMessage variant="error">{mode.message}</StatusMessage>
      </Box>
    );
  }

  // shown
  const { data } = mode;
  return (
    <Box flexDirection="column">
      <Header subtitle={`account · ${mode.name ?? ''}`} />
      <Panel title={mode.name ? `${mode.name}` : 'account'}>
        <Field label="address" value={mode.address} />
        <Field
          label="balance"
          value={data.balance ? formatCoins(data.balance) : '0'}
          valueColor={color.accent}
        />
        {data.account ? (
          <>
            <Field label="account #" value={data.account.accountNumber} />
            <Field label="sequence" value={data.account.sequence} />
            <Field
              label="pubkey"
              value={
                <Text color={color.dim}>{data.account.publicKey ?? '(not yet on-chain)'}</Text>
              }
            />
          </>
        ) : (
          <Field
            label="account"
            value={<Text color={color.muted}>not initialized (no tx sent yet)</Text>}
          />
        )}
      </Panel>
      {data.gasPrice ? (
        <Box marginTop={1}>
          <Panel title="network gas price" borderColor={color.muted}>
            <Field label="rate" value={`${data.gasPrice.price} per ${data.gasPrice.gas} gas`} />
          </Panel>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'Look up another', value: 'again' },
            { label: 'Back to menu', value: 'menu' },
          ]}
          onChange={(v) => (v === 'again' ? setMode({ m: 'pick' }) : nav.back())}
        />
      </Box>
    </Box>
  );
}
