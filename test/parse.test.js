import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../lib/parse.js';

test('parseLine: empty input returns empty structure', () => {
  assert.deepEqual(parseLine(''), { cmd: '', args: [], flags: {} });
  assert.deepEqual(parseLine('   '), { cmd: '', args: [], flags: {} });
});

test('parseLine: basic command without args', () => {
  const res = parseLine('ls');
  assert.equal(res.cmd, 'ls');
  assert.deepEqual(res.args, []);
  assert.deepEqual(res.flags, {});
});

test('parseLine: strips quotes from flag values', () => {
  const res = parseLine('url logo --t="f_auto,q_auto,w_800"');
  assert.equal(res.cmd, 'url');
  assert.deepEqual(res.args, ['logo']);
  assert.equal(res.flags.t, 'f_auto,q_auto,w_800');
});

test('parseLine: handles short flag clustering like -rf', () => {
  const res = parseLine('rm -rf apps/my-app');
  assert.equal(res.cmd, 'rm');
  assert.deepEqual(res.args, ['apps/my-app']);
  assert.equal(res.flags.r, true);
  assert.equal(res.flags.f, true);
});

test('parseLine: coerces numbers and booleans', () => {
  const res = parseLine('tree -d 3 --signed=true --max=50');
  assert.equal(res.cmd, 'tree');
  assert.equal(res.flags.d, 3);
  assert.equal(res.flags.signed, true);
  assert.equal(res.flags.max, 50);
});

test('parseLine: preserves quotes with spaces in arguments', () => {
  const res = parseLine('upload "my pictures/hero image.png" "hero banner"');
  assert.equal(res.cmd, 'upload');
  assert.deepEqual(res.args, ['my pictures/hero image.png', 'hero banner']);
});
