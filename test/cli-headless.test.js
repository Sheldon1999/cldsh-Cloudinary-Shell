import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);
const CLDSH_BIN = path.resolve(process.cwd(), 'cldsh.js');

test('cli headless: --version prints version and exits 0', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [CLDSH_BIN, '--version']);
  assert.equal(stderr, '');
  assert.equal(stdout.trim(), '1.0.0');
});

test('cli headless: --help prints commands list and exits 0', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [CLDSH_BIN, '--help']);
  assert.equal(stderr, '');
  assert.ok(stdout.includes('Commands:'));
  assert.ok(stdout.includes('upload'));
});

test('cli headless: unknown command prints error to stderr and exits 1', async () => {
  await assert.rejects(
    async () => {
      await execFileAsync(process.execPath, [CLDSH_BIN, 'xyz-non-existent-cmd']);
    },
    (err) => {
      assert.equal(err.code, 1);
      assert.ok(err.stderr.includes('Unknown command: xyz-non-existent-cmd'));
      return true;
    }
  );
});

test('cli headless: lpwd outputs process.cwd() and exits 0', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [CLDSH_BIN, 'lpwd']);
  assert.equal(stderr, '');
  assert.equal(stdout.trim(), process.cwd());
});

test('cli headless: upload --dry-run --json outputs clean JSON', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    CLDSH_BIN,
    'upload',
    'package.json',
    '--dry-run',
    '--json',
  ]);
  assert.equal(stderr, '');
  const data = JSON.parse(stdout);
  assert.equal(data.dryRun, true);
  assert.equal(data.isDirectory, false);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].publicId, 'package');
});

test('cli headless: mv --dry-run --json outputs clean JSON', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    CLDSH_BIN,
    'mv',
    'hero',
    'archive/',
    '--dry-run',
    '--json',
  ]);
  assert.equal(stderr, '');
  const data = JSON.parse(stdout);
  assert.equal(data.from, 'hero');
  assert.equal(data.to, 'archive/hero');
  assert.equal(data.dryRun, true);
});

test('cli headless: upload missing file with --json exits 1 with clean stderr', async () => {
  await assert.rejects(
    async () => {
      await execFileAsync(process.execPath, [
        CLDSH_BIN,
        'upload',
        'non-existent-file-xyz.png',
        '--json',
      ]);
    },
    (err) => {
      assert.equal(err.code, 1);
      assert.equal(err.stdout, '');
      assert.ok(err.stderr.includes('Error: File or directory not found'));
      return true;
    }
  );
});
