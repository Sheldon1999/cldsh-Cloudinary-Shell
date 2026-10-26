import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, join, resolveRemote } from '../lib/paths.js';

test('norm: strips slashes, empty segments and backslashes', () => {
  assert.equal(norm('/apps//test/'), 'apps/test');
  assert.equal(norm('\\apps\\sub\\'), 'apps/sub');
  assert.equal(norm(''), '');
});

test('join: skips empty parts', () => {
  assert.equal(join('', 'apps'), 'apps');
  assert.equal(join('/apps/', '/sub/nested/'), 'apps/sub/nested');
  assert.equal(join('', ''), '');
});

test('resolveRemote: relative paths resolve against the current folder', () => {
  assert.equal(resolveRemote('apps', 'sub/a'), 'apps/sub/a');
  assert.equal(resolveRemote('apps', 'hero'), 'apps/hero');
  assert.equal(resolveRemote('apps/my-app', '../other'), 'apps/other');
  assert.equal(resolveRemote('apps/my-app', '.'), 'apps/my-app');
});

test('resolveRemote: leading / or ~ means the root', () => {
  assert.equal(resolveRemote('apps', '/sub/a'), 'sub/a');
  assert.equal(resolveRemote('apps', '~/sub'), 'sub');
  assert.equal(resolveRemote('apps', '~'), '');
  assert.equal(resolveRemote('apps', '/'), '');
  assert.equal(resolveRemote('apps', ''), '');
});

test('resolveRemote: .. never climbs above the root', () => {
  assert.equal(resolveRemote('apps', '..'), '');
  assert.equal(resolveRemote('apps', '../../..'), '');
  assert.equal(resolveRemote('', '../a'), 'a');
});

test('resolveRemote: a name starting with ~ is not the root', () => {
  assert.equal(resolveRemote('apps', '~backup'), 'apps/~backup');
});
