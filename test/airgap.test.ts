// Tests for the acting-account / airgapped-signing pieces.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Settings } from '../src/config.ts';
import { airgapCommands, txCmd, type TxSpec } from '../src/gnokey/api.ts';
import { parseActingArgs } from '../src/ui/launch.ts';

test('parseActingArgs: --address / -a / --account, space and = forms', () => {
  assert.deepEqual(parseActingArgs(['--address', 'g1abc']), { address: 'g1abc' });
  assert.deepEqual(parseActingArgs(['-a', 'g1abc']), { address: 'g1abc' });
  assert.deepEqual(parseActingArgs(['--address=g1abc']), { address: 'g1abc' });
  assert.deepEqual(parseActingArgs(['-a=g1abc']), { address: 'g1abc' });
  assert.deepEqual(parseActingArgs(['--account', 'alice']), { account: 'alice' });
  assert.deepEqual(parseActingArgs(['--account=alice']), { account: 'alice' });
  assert.deepEqual(parseActingArgs(['--other', 'x']), {});
});

const baseSpec: Omit<TxSpec, 'master'> = {
  kind: 'send',
  key: 'g1caller',
  fields: ['-send', '1ugnot', '-to', 'g1dest'],
  gasWanted: '100000',
  gasFee: '1000000ugnot',
};

test('txCmd: master (-master) is added only for the unsigned build', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, chainId: 'gnoland-1' };
  const spec: TxSpec = { ...baseSpec, master: 'g1caller' };

  const unsigned = txCmd(s, spec, 'unsigned').args;
  assert.ok(unsigned.includes('-master'));
  assert.ok(unsigned.includes('-broadcast=false'));
  // -master immediately precedes its address
  assert.equal(unsigned[unsigned.indexOf('-master') + 1], 'g1caller');

  // A real broadcast must NOT take the session/master path.
  const test = txCmd(s, spec, 'test').args;
  assert.ok(!test.includes('-master'));
  assert.ok(test.includes('-broadcast=true'));
});

test('txCmd: no -master when master is unset', () => {
  const s: Settings = { ...DEFAULT_SETTINGS };
  const unsigned = txCmd(s, { ...baseSpec }, 'unsigned').args;
  assert.ok(!unsigned.includes('-master'));
});

test('airgapCommands: builds sign + broadcast with account/chain baked in', () => {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    chainId: 'gnoland-1',
    remote: 'https://rpc.gno.land:443',
    home: '',
  };
  const { sign, broadcast } = airgapCommands(s, {
    txFile: './my.tx',
    keyName: 'alice',
    accountNumber: '42',
    accountSequence: '7',
  });
  assert.match(sign, /^gnokey sign -tx-path \.\/my\.tx -chainid gnoland-1 /);
  assert.match(sign, /-account-number 42 -account-sequence 7 alice$/);
  assert.match(broadcast, /^gnokey broadcast -remote https:\/\/rpc\.gno\.land:443 \.\/my\.tx$/);
});

test('airgapCommands: includes -home when set', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, home: '/tmp/gnohome' };
  const { sign, broadcast } = airgapCommands(s, {
    txFile: 'tx.json',
    keyName: 'k',
    accountNumber: '0',
    accountSequence: '0',
  });
  assert.ok(sign.includes('-home /tmp/gnohome'));
  assert.ok(broadcast.includes('-home /tmp/gnohome'));
});
