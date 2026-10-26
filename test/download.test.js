import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cloudinary, configureSdk } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { CODES } from '../lib/errors.js';
import { planDownload, executeDownload, localFileName } from '../lib/actions/download.js';
import { splitDownloadArgs } from '../commands/download.js';
import { createFakeCloudinary, installFake, installFetchShim } from './helpers/fake-cloudinary.js';
import { runCli, tempDir } from './helpers/cli.js';

function setup(folderMode) {
  configureSdk({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret' });
  const fake = createFakeCloudinary({ folderMode });
  const restoreFake = installFake(cloudinary, fake);
  const restoreFetch = installFetchShim(fake);
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  return { fake, backend, restore: () => { restoreFetch(); restoreFake(); } };
}

const b64 = (s) => Buffer.from(s).toString('base64');
const read = (p) => fs.readFileSync(p, 'utf8');

function seedDl(fake) {
  fake.seed({ public_id: 'dl/hero', format: 'png', content: b64('HERO') });
  fake.seed({ public_id: 'dl/clip', resource_type: 'video', format: 'mp4', content: b64('CLIP') });
  fake.seed({ public_id: 'dl/notes.txt', resource_type: 'raw', content: b64('NOTES') });
  fake.seed({ public_id: 'other/x', content: b64('X') });
}

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] glob download; second run skips existing files; force overwrites`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      seedDl(fake);
      const dest = path.join(tempDir('cldsh-dl-'), 'out');
      const plan = await planDownload(backend, { targets: ['dl/*'], destination: dest });
      const first = await executeDownload(plan);
      assert.deepEqual(first.summary, { total: 3, downloaded: 3, skipped: 0, failed: 0, bytes: 13 });
      assert.deepEqual(fs.readdirSync(dest).sort(), ['clip.mp4', 'hero.png', 'notes.txt']);
      assert.equal(read(path.join(dest, 'hero.png')), 'HERO');
      assert.equal(read(path.join(dest, 'notes.txt')), 'NOTES');

      fs.writeFileSync(path.join(dest, 'hero.png'), 'LOCAL');
      const second = await executeDownload(await planDownload(backend, { targets: ['dl/*'], destination: dest }));
      assert.deepEqual(second.items.map(i => i.status), ['skipped', 'skipped', 'skipped']);
      assert.equal(read(path.join(dest, 'hero.png')), 'LOCAL');

      const forced = await executeDownload(await planDownload(backend, { targets: ['dl/hero*'], destination: dest }), { overwrite: true });
      assert.equal(forced.items[0].status, 'downloaded');
      assert.equal(read(path.join(dest, 'hero.png')), 'HERO');
      assert.deepEqual(fs.readdirSync(dest).sort(), ['clip.mp4', 'hero.png', 'notes.txt'], 'no temp files left behind');
    } finally { restore(); }
  });

  test(`[${mode}] public IDs cannot escape the destination or create dotfiles`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'dl/..', format: 'png', content: b64('DOTDOT') });
      fake.seed({ public_id: 'dl/..\\..\\evil', resource_type: 'raw', content: b64('EVIL') });
      fake.seed({ public_id: 'dl/.env', resource_type: 'raw', content: b64('CLOUDINARY_URL=x') });
      const root = tempDir('cldsh-dl-');
      const dest = path.join(root, 'inner', 'out');
      const plan = await planDownload(backend, { targets: ['dl/*'], destination: dest });
      for (const it of plan.items) assert.equal(path.dirname(it.localPath), dest, it.localPath);
      await executeDownload(plan);
      assert.deepEqual(fs.readdirSync(root), ['inner']);
      assert.deepEqual(fs.readdirSync(path.join(root, 'inner')), ['out']);
      for (const name of fs.readdirSync(dest)) assert.ok(!name.startsWith('.'), name);
    } finally { restore(); }
  });
}

test('localFileName: format appended when missing, separators and leading dots neutralized', () => {
  assert.equal(localFileName({ public_id: 'a/b/hero', format: 'png' }), 'hero.png');
  assert.equal(localFileName({ public_id: 'hero.png', format: 'png' }), 'hero.png');
  assert.equal(localFileName({ public_id: 'v1.2', format: 'jpg' }), 'v1.2.jpg');
  assert.equal(localFileName({ public_id: 'docs/notes.txt' }), 'notes.txt');
  assert.equal(localFileName({ public_id: 'x/..' }), '__');
  assert.equal(localFileName({ public_id: 'x/.env' }), '_env');
  assert.equal(localFileName({ public_id: 'x/a\\..\\b' }), 'b');
  assert.equal(localFileName({ public_id: 'x/a\u0000b' }), 'a_b');
});

test('single asset to a file path; missing destination directory is created', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    seedDl(fake);
    const root = tempDir('cldsh-dl-');
    const asFile = path.join(root, 'copy.png');
    const r1 = await executeDownload(await planDownload(backend, { cwd: 'dl', targets: ['hero'], destination: asFile }));
    assert.equal(r1.items[0].status, 'downloaded');
    assert.equal(read(asFile), 'HERO');

    const r2 = await executeDownload(await planDownload(backend, { cwd: 'dl', targets: ['hero'], destination: path.join(root, 'new') + path.sep }));
    assert.equal(r2.items[0].localPath, path.join(root, 'new', 'hero.png'));
    assert.equal(read(path.join(root, 'new', 'hero.png')), 'HERO');
  } finally { restore(); }
});

test('private and authenticated assets download through signed URLs', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'sec/doc', type: 'private', format: 'pdf', content: b64('PRIVATE') });
    fake.seed({ public_id: 'sec/pic', type: 'authenticated', format: 'jpg', content: b64('AUTH') });
    const dest = tempDir('cldsh-dl-');
    const plan = await planDownload(backend, { targets: ['sec/doc', 'sec/pic'], destination: dest + path.sep });
    const byId = Object.fromEntries(plan.items.map(i => [i.public_id, i]));
    assert.match(byId['sec/doc'].url, /^https:\/\/api\.cloudinary\.com\/v1_1\/fake-cloud\/image\/download\?.*signature=/);
    assert.match(byId['sec/pic'].url, /\/image\/authenticated\/s--[^/]+--\//);
    const res = await executeDownload(plan);
    assert.equal(res.summary.downloaded, 2);
    assert.equal(read(path.join(dest, 'doc.pdf')), 'PRIVATE');
    assert.equal(read(path.join(dest, 'pic.jpg')), 'AUTH');
  } finally { restore(); }
});

test('several targets: a missing one fails alone; a single missing target throws; sandbox refusals fail the item', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    seedDl(fake);
    const dest = tempDir('cldsh-dl-');
    const res = await executeDownload(await planDownload(backend, { cwd: 'dl', targets: ['hero', 'ghost', 'nomatch*'], destination: dest }));
    assert.deepEqual(res.summary, { total: 3, downloaded: 1, skipped: 0, failed: 2, bytes: 4 });
    assert.deepEqual(res.items.filter(i => i.status === 'failed').map(i => [i.target, i.error_code]), [['ghost', CODES.NOT_FOUND], ['nomatch*', CODES.NOT_FOUND]]);

    await assert.rejects(planDownload(backend, { cwd: 'dl', targets: ['ghost'] }), { code: CODES.NOT_FOUND });

    const refused = await executeDownload(await planDownload(backend, { cwd: 'dl', targets: ['clip'], destination: dest }), { allowPath: () => false });
    assert.equal(refused.items[0].status, 'failed');
    assert.equal(refused.items[0].error_code, CODES.FORBIDDEN);
    assert.ok(!fs.existsSync(path.join(dest, 'clip.mp4')));
  } finally { restore(); }
});

test('download argument split: 2 args = target + destination; 3+ only when the last is a directory', () => {
  const dir = tempDir('cldsh-dl-');
  assert.deepEqual(splitDownloadArgs(['hero']), { targets: ['hero'], destination: undefined });
  assert.deepEqual(splitDownloadArgs(['hero', 'copy.png']), { targets: ['hero'], destination: 'copy.png' });
  assert.deepEqual(splitDownloadArgs(['a', 'b', 'out/']), { targets: ['a', 'b'], destination: 'out/' });
  assert.deepEqual(splitDownloadArgs(['a', 'b', dir]), { targets: ['a', 'b'], destination: dir });
  assert.deepEqual(splitDownloadArgs(['a', 'b', 'c']), { targets: ['a', 'b', 'c'], destination: undefined });
});

// ---------------------------------------------------------------- CLI

test('cli: glob download into a directory, then skipped on the second run (exit 0), --force overwrites', async () => {
  const fake = createFakeCloudinary();
  seedDl(fake);
  const cwd = tempDir('cldsh-cwd-');
  const first = await runCli(['download', 'dl/*', 'out', '--json'], { fake, cwd });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).summary.downloaded, 3);
  assert.equal(read(path.join(cwd, 'out', 'clip.mp4')), 'CLIP');
  assert.match(first.stderr, /\[\d\/3\] downloaded /);

  const second = await runCli(['download', 'dl/*', 'out'], { fake: createFakeCloudinary({ state: first.state }), cwd });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /Downloaded 0 of 3 .*3 skipped/);

  const forced = await runCli(['download', 'dl/hero', '-f', '--json'], { fake: createFakeCloudinary({ state: first.state }), cwd });
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).items[0].status, 'downloaded');
  assert.equal(read(path.join(cwd, 'hero.png')), 'HERO');
});

test('cli: missing asset exits 1; partly missing targets exit 3', async () => {
  const fake = createFakeCloudinary();
  seedDl(fake);
  const cwd = tempDir('cldsh-cwd-');
  const missing = await runCli(['download', 'dl/ghost'], { fake, cwd });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /No such asset/);
  const partial = await runCli(['download', 'dl/hero', 'dl/ghost', './', '--json'], { fake, cwd });
  assert.equal(partial.code, 3, partial.stderr);
  assert.equal(JSON.parse(partial.stdout).summary.failed, 1);
});
