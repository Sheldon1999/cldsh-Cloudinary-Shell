import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePath } from '../lib/cld.js';
import cdCmd from '../commands/cd.js';

test('resolvePath: parent and relative segments', () => {
  assert.equal(resolvePath('apps/my-app', '..'), 'apps');
  assert.equal(resolvePath('apps/my-app', '../other-app'), 'apps/other-app');
  assert.equal(resolvePath('apps/my-app', '../../'), '');
  assert.equal(resolvePath('apps/my-app', '.'), 'apps/my-app');
});

test('resolvePath: absolute and tilde paths', () => {
  assert.equal(resolvePath('apps/my-app', '/root-folder'), 'root-folder');
  assert.equal(resolvePath('apps/my-app', '~/root-folder'), 'root-folder');
  assert.equal(resolvePath('apps/my-app', '~'), '');
  assert.equal(resolvePath('apps/my-app', '/'), '');
  assert.equal(resolvePath('apps/my-app', ''), '');
});

test('cd command: cd ~ or cd / resets to root', async () => {
  let cwd = 'apps/my-app';
  let prevCwd = '';
  const ctx = {
    get cwd() { return cwd; },
    get prevCwd() { return prevCwd; },
    setCwd(next) { prevCwd = cwd; cwd = next; },
    utils: { resolvePath, folderExists: async () => true },
    printer: { println: () => {}, warn: s => s },
  };

  await cdCmd(ctx, ['/']);
  assert.equal(ctx.cwd, '');

  await cdCmd(ctx, ['-']);
  assert.equal(ctx.cwd, 'apps/my-app');
});
