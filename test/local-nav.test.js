import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import lcdCmd from '../commands/lcd.js';
import lpwdCmd from '../commands/lpwd.js';

test('local navigation: lpwd prints process.cwd()', async () => {
  let printed = '';
  const ctx = {
    printer: { println: msg => { printed = msg; } },
  };

  await lpwdCmd(ctx);
  assert.equal(printed, process.cwd());
});

test('local navigation: lcd changes directory and restores', async () => {
  const origDir = process.cwd();
  const tmpDir = os.tmpdir();
  let printed = '';
  const ctx = {
    printer: {
      println: msg => { printed = msg; },
      ok: msg => msg,
      warn: msg => msg,
    },
  };

  try {
    await lcdCmd(ctx, [tmpDir]);
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(tmpDir));

    // Return back
    await lcdCmd(ctx, [origDir]);
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(origDir));
  } finally {
    process.chdir(origDir);
  }
});
