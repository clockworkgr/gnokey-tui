// Unit tests for the gnokey output parsers, using real captured output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isErrorOutput,
  parseAccount,
  parseError,
  parseGasPrice,
  parseKeyList,
  parseQuery,
  parseStorage,
  parseTxMetrics,
} from '../src/gnokey/parse.ts';
import { formatCoins, shortAddr } from '../src/format.ts';

test('parseKeyList: local, ledger, multisig', () => {
  const out = [
    "0. alice (local) - addr: g1hx3m9qazxku66up4yj6eydqg9lyaklc0vvc3m6 pub: gpub1abc, path: <nil>",
    "1. clock (ledger) - addr: g1h4pjlzf6v0qfwjpqj72434z27jrp7wszwjf87h pub: gpub1def, path: 44'/118'/0'/0/0",
    '2. ms-ab (multi) - addr: g1s4e75jkf7pmxxtd27q5f3feue00x2ce62vgug7 pub: [gpub1x, gpub1y], path: <nil>',
  ].join('\n');
  const keys = parseKeyList(out);
  assert.equal(keys.length, 3);

  assert.equal(keys[0].name, 'alice');
  assert.equal(keys[0].type, 'local');
  assert.equal(keys[0].address, 'g1hx3m9qazxku66up4yj6eydqg9lyaklc0vvc3m6');
  assert.equal(keys[0].canSign, true);
  assert.equal(keys[0].path, undefined);

  assert.equal(keys[1].type, 'ledger');
  assert.equal(keys[1].path, "44'/118'/0'/0/0");
  assert.equal(keys[1].canSign, true);

  assert.equal(keys[2].type, 'multi');
  assert.equal(keys[2].canSign, false);
  assert.deepEqual(keys[2].pubkeys, ['gpub1x', 'gpub1y']);
});

test('parseQuery: single-line and multi-line data', () => {
  const single = 'height: 0\ndata: "9969353159ugnot"\n';
  assert.deepEqual(parseQuery(single), { height: 0, data: '"9969353159ugnot"' });

  const multi = 'height: 0\ndata: line1\nline2\nline3\n';
  const r = parseQuery(multi);
  assert.equal(r.height, 0);
  assert.equal(r.data, 'line1\nline2\nline3');
});

test('parseGasPrice', () => {
  const gp = parseGasPrice('{\n  "gas": "1000",\n  "price": "1ugnot"\n}');
  assert.deepEqual(gp, { gas: '1000', price: '1ugnot' });
});

test('parseAccount', () => {
  const data = JSON.stringify({
    BaseAccount: {
      address: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5',
      coins: '9969353159ugnot',
      public_key: { '@type': '/tm.PubKeySecp256k1', value: 'A+Fh…' },
      account_number: '2701052',
      sequence: '6',
    },
    attributes: '0',
  });
  const acc = parseAccount(data);
  assert.ok(acc);
  assert.equal(acc!.accountNumber, '2701052');
  assert.equal(acc!.sequence, '6');
  assert.equal(acc!.coins, '9969353159ugnot');
  assert.equal(acc!.publicKey, 'A+Fh…');
});

test('parseAccount: uninitialized returns fields with null pubkey', () => {
  const acc = parseAccount('{"BaseAccount":{"address":"g1x","coins":"","public_key":null,"account_number":"0","sequence":"0"}}');
  assert.ok(acc);
  assert.equal(acc!.publicKey, null);
});

test('parseTxMetrics: successful send', () => {
  const out = [
    '',
    'OK!',
    'GAS WANTED: 100000',
    'GAS USED:   30831',
    'HEIGHT:     42',
    'EVENTS:     []',
    'INFO:       ',
    'TX HASH:    abc123==',
  ].join('\n');
  const m = parseTxMetrics(out);
  assert.equal(m.ok, true);
  assert.equal(m.gasUsed, '30831');
  assert.equal(m.gasWanted, '100000');
  assert.equal(m.height, '42');
  assert.equal(m.txHash, 'abc123==');
});

test('parseTxMetrics: dry-run estimate parses INFO', () => {
  const out = [
    'OK!',
    'GAS WANTED: 100000',
    'GAS USED:   30831',
    'HEIGHT:     0',
    'INFO:       estimated gas usage: 30831 (suggested, with 5% margin: 32373), gas fee: 30ugnot, current gas price: 1ugnot/1000gas',
    'TX HASH:    ',
  ].join('\n');
  const m = parseTxMetrics(out);
  assert.equal(m.estimatedGas, '30831');
  assert.equal(m.suggestedGas, '32373');
  assert.equal(m.estimatedFee, '30ugnot');
});

test('parseError: boxed error', () => {
  const stderr = '--= Error =--\nData: pkgpath not specified\nMsg Traces:\n--= /Error =--\n';
  assert.equal(parseError(stderr), 'pkgpath not specified');
});

test('parseError: bare line', () => {
  assert.equal(parseError('Key nonexistentkey not found\n'), 'Key nonexistentkey not found');
});

test('parseError: unwraps Go errorString', () => {
  const stdout =
    'Log: --= Error =--\nData: &errors.errorString{s:"gno.land/r/x:0:0: name Nope not declared:\\n--- preprocess stack ---"}\n';
  const msg = parseError('', stdout);
  assert.ok(msg.startsWith('gno.land/r/x:0:0: name Nope not declared'));
  assert.ok(!msg.includes('errorString'));
});

test('isErrorOutput', () => {
  assert.equal(isErrorOutput(0, ''), false);
  assert.equal(isErrorOutput(1, ''), true);
  assert.equal(isErrorOutput(0, '--= Error =--\nData: boom'), true);
});

test('parseStorage', () => {
  assert.deepEqual(parseStorage('storage: 22048, deposit: 2204800'), {
    storage: '22048',
    deposit: '2204800',
  });
});

test('formatCoins', () => {
  assert.equal(formatCoins('9969353159ugnot'), '9,969.353159 GNOT  (9,969,353,159 ugnot)');
  assert.equal(formatCoins('1000000ugnot'), '1 GNOT  (1,000,000 ugnot)');
  assert.equal(formatCoins('500ugnot'), '0.0005 GNOT  (500 ugnot)');
  assert.equal(formatCoins('42foo'), '42foo'); // non-ugnot passthrough
});

test('shortAddr', () => {
  assert.equal(shortAddr('g1hx3m9qazxku66up4yj6eydqg9lyaklc0vvc3m6'), 'g1hx3m9q…c3m6');
  assert.equal(shortAddr('g1short'), 'g1short');
});
