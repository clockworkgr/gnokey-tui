// Tests for password-strategy resolution and the stripAuth helper.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Settings } from '../src/config.ts';
import {
  binFor,
  needsInAppPassword,
  planPwCommand,
  resolveStrategy,
} from '../src/gnokey/authexec.ts';
import { stripAuth, type Cmd } from '../src/gnokey/api.ts';

const withSource = (source: Settings['passwordSource']): Settings => ({
  ...DEFAULT_SETTINGS,
  passwordSource: source,
});

test('resolveStrategy: prompt source is interactive for a local key', () => {
  assert.equal(resolveStrategy(withSource('prompt'), 'local'), 'interactive');
});

test('resolveStrategy: keychain source is keychain, unless noKeychain', () => {
  assert.equal(resolveStrategy(withSource('keychain'), 'local'), 'keychain');
  assert.equal(
    resolveStrategy(withSource('keychain'), 'local', { noKeychain: true }),
    'interactive',
  );
});

test('resolveStrategy: stdin source is stdin', () => {
  assert.equal(resolveStrategy(withSource('stdin'), 'local'), 'stdin');
});

test('resolveStrategy: a Ledger key is always interactive', () => {
  for (const src of ['prompt', 'keychain', 'stdin'] as const) {
    assert.equal(resolveStrategy(withSource(src), 'ledger'), 'interactive');
  }
});

test('needsInAppPassword: only true for the stdin strategy', () => {
  assert.equal(needsInAppPassword(withSource('stdin'), 'local'), true);
  assert.equal(needsInAppPassword(withSource('prompt'), 'local'), false);
  assert.equal(needsInAppPassword(withSource('keychain'), 'local'), false);
  assert.equal(needsInAppPassword(withSource('stdin'), 'ledger'), false); // ledger overrides
});

test('binFor: keychain strategy uses kcBin, others use bin', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, bin: 'gnokey', kcBin: 'gnokeykc' };
  assert.equal(binFor(s, 'keychain'), 'gnokeykc');
  assert.equal(binFor(s, 'stdin'), 'gnokey');
  assert.equal(binFor(s, 'interactive'), 'gnokey');
});

test('planPwCommand: dispatches per strategy and strips auth for non-stdin', () => {
  const stdinCmd: Cmd = {
    args: ['maketx', 'send', '-insecure-password-stdin', 'alice'],
    stdinLines: ['pw'],
  };
  const s = { ...DEFAULT_SETTINGS, bin: 'gnokey', kcBin: 'gnokeykc' };

  // prompt → interactive, terminal gets the stripped command, no stdin
  const prompt = planPwCommand({ ...s, passwordSource: 'prompt' }, {}, stdinCmd);
  assert.equal(prompt.kind, 'interactive');
  if (prompt.kind === 'interactive') {
    assert.equal(prompt.bin, 'gnokey');
    assert.ok(!prompt.args.includes('-insecure-password-stdin'));
  }

  // keychain → piped via gnokeykc, stripped, no password
  const kc = planPwCommand({ ...s, passwordSource: 'keychain' }, {}, stdinCmd);
  assert.equal(kc.kind, 'piped');
  if (kc.kind === 'piped') {
    assert.equal(kc.bin, 'gnokeykc');
    assert.ok(!kc.cmd.args.includes('-insecure-password-stdin'));
    assert.equal(kc.cmd.stdinLines, undefined);
  }

  // stdin → piped via gnokey, command untouched (password preserved)
  const std = planPwCommand({ ...s, passwordSource: 'stdin' }, {}, stdinCmd);
  assert.equal(std.kind, 'piped');
  if (std.kind === 'piped') {
    assert.equal(std.bin, 'gnokey');
    assert.ok(std.cmd.args.includes('-insecure-password-stdin'));
    assert.deepEqual(std.cmd.stdinLines, ['pw']);
  }

  // ledger → interactive even under a piped source
  const led = planPwCommand({ ...s, passwordSource: 'stdin' }, { keyType: 'ledger' }, stdinCmd);
  assert.equal(led.kind, 'interactive');
});

test('stripAuth removes the password flag and stdin lines', () => {
  const cmd: Cmd = {
    args: ['maketx', 'send', '-insecure-password-stdin', '-remote', 'x', 'alice'],
    stdinLines: ['hunter2'],
    redactStdin: true,
  };
  const stripped = stripAuth(cmd);
  assert.ok(!stripped.args.includes('-insecure-password-stdin'));
  assert.deepEqual(stripped.args, ['maketx', 'send', '-remote', 'x', 'alice']);
  assert.equal(stripped.stdinLines, undefined);
  assert.equal(stripped.redactStdin, false);
});
