import type React from 'react';
// Root component: owns global state (settings, keys, version), the screen
// router, and the startup check that gnokey is reachable.
import { Alert, Select, Spinner, TextInput } from '@inkjs/ui';
import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadSettings,
  saveSettings,
  settingsConfigPath,
  type Settings,
} from '../config.ts';
import { gnokeyVersion } from '../gnokey/exec.ts';
import { listKeys } from '../gnokey/api.ts';
import type { KeyInfo } from '../gnokey/types.ts';
import {
  AppContext,
  type ActingAccount,
  type Nav,
  type ScreenEntry,
} from './context.tsx';
import { interactiveStore } from './interactiveStore.ts';
import { launch } from './launch.ts';
import { Header } from './components.tsx';
import { color } from './theme.ts';
import { Home } from './screens/Home.tsx';
import { KeysScreen } from './screens/Keys.tsx';
import { AddKeyScreen } from './screens/AddKey.tsx';
import { QueryScreen } from './screens/Query.tsx';
import { AccountScreen } from './screens/Account.tsx';
import { SettingsScreen } from './screens/Settings.tsx';
import { AboutScreen } from './screens/About.tsx';
import { TxScreen } from './screens/Tx.tsx';

type Boot =
  | { phase: 'checking' }
  | { phase: 'ok'; version: string }
  | { phase: 'error'; message: string };

export function App(): React.ReactNode {
  const { exit } = useInkApp();
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const [boot, setBoot] = useState<Boot>(() => {
    const v = interactiveStore.getVersion(settings.bin);
    return v ? { phase: 'ok', version: v } : { phase: 'checking' };
  });
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | undefined>();
  const [stack, setStack] = useState<ScreenEntry[]>([{ name: 'home' }]);
  const [flash, setFlash] = useState<string | undefined>(
    () => interactiveStore.takeFlash() ?? undefined,
  );
  // The acting account from --address/--account (an address is available at
  // once; keybase details are filled in when keys load).
  const [acting, setActing] = useState<ActingAccount | undefined>(() => {
    const { address } = launch.get();
    return address ? { address, inKeybase: false, canSign: false } : undefined;
  });

  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    saveSettings(next);
  }, []);

  const refreshKeys = useCallback(async () => {
    setKeysLoading(true);
    setKeysError(undefined);
    try {
      setKeys(await listKeys(settings));
    } catch (err) {
      setKeysError((err as Error).message);
      setKeys([]);
    } finally {
      setKeysLoading(false);
    }
  }, [settings]);

  // Startup / re-check whenever the binary path changes. Skips the check when a
  // version for this binary is already cached (e.g. remount after an
  // interactive run), to avoid a spinner flicker.
  useEffect(() => {
    if (interactiveStore.getVersion(settings.bin)) return;
    let cancelled = false;
    setBoot({ phase: 'checking' });
    gnokeyVersion(settings.bin)
      .then((version) => {
        interactiveStore.setVersion(settings.bin, version);
        if (!cancelled) setBoot({ phase: 'ok', version });
      })
      .catch((err: Error) => {
        if (!cancelled) setBoot({ phase: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [settings.bin]);

  // Load keys once gnokey is confirmed, and whenever the home dir changes.
  useEffect(() => {
    if (boot.phase === 'ok') void refreshKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.phase, settings.home, settings.bin]);

  // Resolve the launch-flag acting account against the loaded keybase, so a
  // --address that happens to be a known key picks up its name / signing ability.
  useEffect(() => {
    const { address, account } = launch.get();
    if (!address && !account) return;
    if (account) {
      const k = keys.find((x) => x.name === account);
      if (k)
        setActing({
          address: k.address,
          name: k.name,
          keyType: k.type,
          inKeybase: true,
          canSign: k.canSign,
        });
      return;
    }
    const k = keys.find((x) => x.address === address);
    setActing({
      address: address as string,
      name: k?.name,
      keyType: k?.type,
      inKeybase: Boolean(k),
      canSign: k?.canSign ?? false,
    });
  }, [keys]);

  const nav: Nav = useMemo(
    () => ({
      stack,
      go: (name, params) => setStack((s) => [...s, { name, params }]),
      replace: (name, params) =>
        setStack((s) => [...s.slice(0, -1), { name, params }]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    }),
    [stack],
  );

  const version = boot.phase === 'ok' ? boot.version : '…';

  // Suspend the UI and hand gnokey the terminal (see interactiveStore).
  const runInteractive = useCallback(
    (args: string[], header: string, flashMsg: string) => {
      interactiveStore.setPending({ bin: settings.bin, args, header, flash: flashMsg });
      exit();
    },
    [settings.bin, exit],
  );

  const clearFlash = useCallback(() => setFlash(undefined), []);

  const ctx = useMemo(
    () => ({
      settings,
      setSettings,
      keys,
      keysLoading,
      keysError,
      refreshKeys,
      version,
      nav,
      acting,
      runInteractive,
      flash,
      clearFlash,
    }),
    [
      settings,
      setSettings,
      keys,
      keysLoading,
      keysError,
      refreshKeys,
      version,
      nav,
      acting,
      runInteractive,
      flash,
      clearFlash,
    ],
  );

  if (boot.phase === 'checking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Box>
          <Spinner label={`Checking ${settings.bin}…`} />
        </Box>
      </Box>
    );
  }

  if (boot.phase === 'error') {
    return (
      <BootError
        message={boot.message}
        settings={settings}
        exit={exit}
        setSettings={setSettings}
      />
    );
  }

  const current = stack[stack.length - 1];

  return (
    <AppContext.Provider value={ctx}>
      <Box flexDirection="column" padding={1}>
        <Screen entry={current} />
      </Box>
    </AppContext.Provider>
  );
}

function Screen({ entry }: { entry: ScreenEntry }): React.ReactNode {
  switch (entry.name) {
    case 'home':
      return <Home />;
    case 'keys':
      return <KeysScreen />;
    case 'addkey':
      return <AddKeyScreen />;
    case 'query':
      return <QueryScreen />;
    case 'account':
      return <AccountScreen params={entry.params} />;
    case 'settings':
      return <SettingsScreen />;
    case 'about':
      return <AboutScreen />;
    case 'tx':
      return <TxScreen params={entry.params} />;
    default:
      return <Text color={color.red}>Unknown screen: {entry.name}</Text>;
  }
}

// Shown when gnokey cannot be found or run. Lets the user fix the path or quit.
function BootError({
  message,
  settings,
  exit,
  setSettings,
}: {
  message: string;
  settings: Settings;
  exit: () => void;
  setSettings: (s: Settings) => void;
}): React.ReactNode {
  const [editing, setEditing] = useState(false);

  useInput((input) => {
    if (!editing && (input === 'q' || input === 'Q')) exit();
  });

  if (editing) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <MiniBinEditor
          initial={settings.bin}
          onSubmit={(bin) => {
            setSettings({ ...settings, bin });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header />
      <Alert variant="error">gnokey is not reachable</Alert>
      <Box marginY={1}>
        <Text color={color.dim}>{message}</Text>
      </Box>
      <Text color={color.muted}>Settings file: {settingsConfigPath()}</Text>
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'Set path to the gnokey binary', value: 'edit' },
            { label: 'Quit', value: 'quit' },
          ]}
          onChange={(v) => (v === 'quit' ? exit() : setEditing(true))}
        />
      </Box>
    </Box>
  );
}

function MiniBinEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}): React.ReactNode {
  useInput((_i, key) => {
    if (key.escape) onCancel();
  });
  return (
    <Box flexDirection="column">
      <Text color={color.muted}>Path to gnokey binary (esc to cancel):</Text>
      <TextInput defaultValue={initial} onSubmit={onSubmit} />
    </Box>
  );
}
