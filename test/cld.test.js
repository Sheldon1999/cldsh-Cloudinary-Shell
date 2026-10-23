import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, join } from '../lib/cld.js';
import { formatBytes } from '../lib/printer.js';

test('cld utils: norm trims slashes and replaces backslashes', () => {
  assert.equal(norm(''), '');
  assert.equal(norm('/apps/test/'), 'apps/test');
  assert.equal(norm('\\apps\\sub\\'), 'apps/sub');
  assert.equal(norm('single'), 'single');
});

test('cld utils: join joins normalized parts', () => {
  assert.equal(join('', 'apps'), 'apps');
  assert.equal(join('apps', 'sub'), 'apps/sub');
  assert.equal(join('/apps/', '/sub/nested/'), 'apps/sub/nested');
  assert.equal(join('', ''), '');
});

test('printer utils: formatBytes converts byte counts cleanly', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(2500000), '2.4 MB');
});
