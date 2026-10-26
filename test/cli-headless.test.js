import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runCli, tempDir } from './helpers/cli.js';
import { createFakeCloudinary } from './helpers/fake-cloudinary.js';

const { version } = createRequire(import.meta.url)('../package.json');

test('--version prints the package version', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), version);
});

test('--help lists commands and exits 0 without credentials', async () => {
  const r = await runCli(['--help'], { credentials: false });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Commands:/);
  assert.match(r.stdout, /upload/);
});

test('unknown command and unknown option exit 2 with a suggestion', async () => {
  const a = await runCli(['lss']);
  assert.equal(a.code, 2);
  assert.match(a.stderr, /Unknown command: lss/);
  assert.match(a.stderr, /did you mean "ls"/);
  const b = await runCli(['ls', '--lnog']);
  assert.equal(b.code, 2);
  assert.match(b.stderr, /unknown option --lnog/);
});

test('no credentials: exit 1 with login guidance', async () => {
  const r = await runCli(['ls'], { credentials: false });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Not connected to a Cloudinary account/);
});

test('API errors exit 1, keep stdout empty under --json, and print the real message', async () => {
  const fake = createFakeCloudinary();
  const r = await runCli(['ls', 'nope', '--json'], { fake });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  const err = JSON.parse(r.stderr.trim().split('\n').pop());
  assert.equal(err.error.code, 'NOT_FOUND');
  assert.match(err.error.message, /No such folder: nope/);
});

test('--json output piped through a child process is not truncated', async () => {
  const fake = createFakeCloudinary();
  for (let i = 0; i < 4000; i++) fake.seed({ public_id: `big/asset-${String(i).padStart(5, '0')}-${'x'.repeat(40)}` });
  const r = await runCli(['ls', 'big', '--json'], { fake });
  assert.equal(r.code, 0);
  assert.ok(r.stdout.length > 1_500_000, `stdout length ${r.stdout.length}`);
  assert.equal(JSON.parse(r.stdout).files.length, 4000);
});

test('cd is rejected outside the shell', async () => {
  const r = await runCli(['cd', 'apps']);
  assert.equal(r.code, 2);
});

test('rm refuses names that look like a local shell wildcard expansion', async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, 'a.png'), '');
  fs.mkdirSync(path.join(cwd, 'assets'));
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'a' });
  fake.seedFolder('assets');
  const r = await runCli(['rm', '-rf', 'a.png', 'assets'], { fake, cwd });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /shell probably expanded a wildcard/);
  assert.equal(r.calls.filter(c => /delete|destroy/.test(c.method)).length, 0);
});

test('a low Admin API budget is reported on stderr', async () => {
  const fake = createFakeCloudinary();
  fake.setRateRemaining(20);
  const r = await runCli(['ls'], { fake });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Admin API requests left this hour/);
});

test('the folder mode is detected once and remembered across single commands', async () => {
  const home = tempDir('cldsh-home-');
  const fake = createFakeCloudinary();
  const first = await runCli(['ls'], { fake, home });
  const second = await runCli(['ls'], { fake, home });
  assert.equal(first.calls.filter(c => c.method === 'config').length, 1);
  assert.equal(second.calls.filter(c => c.method === 'config').length, 0);
  assert.equal((fs.statSync(path.join(home, '.config', 'cldsh', 'folder-modes.json')).mode & 0o777), 0o600);
});
