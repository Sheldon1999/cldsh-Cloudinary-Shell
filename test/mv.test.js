import test from 'node:test';
import assert from 'node:assert/strict';
import mvCmd from '../commands/mv.js';
import { norm, join, resolvePath } from '../lib/cld.js';

test('mv: dry-run prints planned rename without making API call', async () => {
  let printed = '';
  const ctx = {
    cwd: 'portfolio',
    utils: {
      norm,
      join,
      resolvePath,
      folderExists: async () => false,
    },
    printer: {
      warn: msg => { printed = msg; return msg; },
      dim: msg => msg,
      println: msg => { printed = msg; },
    },
  };

  await mvCmd(ctx, ['hero', 'hero-v2'], { 'dry-run': true });
  assert.ok(printed.includes('[DRY-RUN] Would rename: portfolio/hero -> portfolio/hero-v2'));
});

test('mv: moves into folder if target ends with slash', async () => {
  let printed = '';
  const ctx = {
    cwd: 'portfolio',
    utils: {
      norm,
      join,
      resolvePath,
      folderExists: async () => true,
    },
    printer: {
      warn: msg => { printed = msg; return msg; },
      dim: msg => msg,
      println: msg => { printed = msg; },
    },
  };

  await mvCmd(ctx, ['hero', 'archive/'], { 'dry-run': true });
  assert.ok(printed.includes('portfolio/hero -> portfolio/archive/hero'));
});
