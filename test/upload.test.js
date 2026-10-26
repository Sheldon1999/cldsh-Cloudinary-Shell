import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cloudinary } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { planUpload, executeUpload, LARGE_FILE_BYTES } from '../lib/actions/upload.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { runCli, tempDir } from './helpers/cli.js';

function setup(folderMode) {
  const fake = createFakeCloudinary({ folderMode });
  const restore = installFake(cloudinary, fake);
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  return { fake, backend, restore };
}

function makeTree(files) {
  const root = tempDir('cldsh-up-');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content));
  }
  return root;
}

const MIXED = { 'a.png': 'png', 'b.mp4': 'mp4', 'c.mp3': 'mp3', 'd.pdf': 'pdf', 'e.txt': 'txt', 'f.json': '{}', '.hidden': 'no', 'sub/g.png': 'g' };
const fast = { retryDelayMs: 1 };
const uploadCalls = (fake) => fake.calls.filter(c => c.method === 'upload' || c.method === 'upload_large');

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] upload -r of a mixed directory uploads every file with its resource type`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      const root = makeTree(MIXED);
      const plan = planUpload({ cwd: 'mix', localPath: root, recursive: true });
      const res = await executeUpload(backend, plan, fast);
      assert.deepEqual(res.summary, { total: 7, created: 7, overwritten: 0, skipped: 0, failed: 0 });
      const got = fake.state.assets.map(a => [a.public_id, a.resource_type]).sort();
      assert.deepEqual(got, [
        ['mix/a', 'image'], ['mix/b', 'video'], ['mix/c', 'video'], ['mix/d', 'image'],
        ['mix/e.txt', 'raw'], ['mix/f.json', 'raw'], ['mix/sub/g', 'image'],
      ]);
      for (const it of res.items) assert.match(it.url, /^https:\/\/res\.cloudinary\.com\/fake-cloud\//);
      const folders = Object.fromEntries(uploadCalls(fake).map(c => [c.args[1].public_id, c.args[1].asset_folder]));
      if (mode === 'dynamic') {
        assert.equal(folders['mix/a'], 'mix');
        assert.equal(folders['mix/sub/g'], 'mix/sub');
        assert.deepEqual(fake.state.assets.find(a => a.public_id === 'mix/sub/g').asset_folder, 'mix/sub');
      } else {
        assert.ok(Object.values(folders).every(f => f === undefined), 'fixed mode sends no asset_folder');
      }
    } finally { restore(); }
  });

  test(`[${mode}] re-upload reports overwritten; --no-overwrite reports skipped and keeps the asset`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      const root = makeTree({ 'hero.png': 'v1' });
      const file = path.join(root, 'hero.png');
      const first = await executeUpload(backend, planUpload({ localPath: file }), fast);
      assert.equal(first.items[0].status, 'created');
      fs.writeFileSync(file, 'v2');
      const second = await executeUpload(backend, planUpload({ localPath: file }), fast);
      assert.equal(second.items[0].status, 'overwritten');
      fs.writeFileSync(file, 'v3');
      const third = await executeUpload(backend, planUpload({ localPath: file }), { ...fast, overwrite: false });
      assert.equal(third.items[0].status, 'skipped');
      assert.equal(Buffer.from(fake.state.assets[0].content, 'base64').toString(), 'v2');
      assert.equal(uploadCalls(fake).at(-1).args[1].overwrite, false);
    } finally { restore(); }
  });
}

test('transient failures are retried: two 5xx then success; 4xx fails at once; three 420s give up', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    const file = path.join(makeTree({ 'a.png': 1 }), 'a.png');
    fake.failNext('upload', { times: 2 });
    const ok = await executeUpload(backend, planUpload({ localPath: file }), fast);
    assert.equal(ok.items[0].status, 'created');
    assert.equal(ok.items[0].attempts, 3);
    assert.equal(uploadCalls(fake).length, 3);

    fake.failNext('upload', { times: 1, error: { error: { message: 'Invalid image file', http_code: 400 } } });
    const bad = await executeUpload(backend, planUpload({ localPath: file }), fast);
    assert.equal(bad.items[0].status, 'failed');
    assert.equal(bad.items[0].attempts, 1);
    assert.equal(bad.items[0].error, 'Invalid image file');

    // The uploader's own rejection shape is { message, http_code } (not the Admin API's { error: {...} }).
    fake.failNext('upload', { times: 3, error: { message: 'Rate Limit Exceeded', http_code: 420 } });
    const limited = await executeUpload(backend, planUpload({ localPath: file }), fast);
    assert.equal(limited.items[0].status, 'failed');
    assert.equal(limited.items[0].attempts, 3);
    assert.equal(limited.items[0].error_code, 'RATE_LIMITED');
  } finally { restore(); }
});

test('files over 20 MB use chunked upload_large; smaller ones use upload', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    const root = makeTree({ 'small.mp4': 'x' });
    const big = path.join(root, 'big.mp4');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, LARGE_FILE_BYTES + 1); // sparse: no real disk usage
    const res = await executeUpload(backend, planUpload({ localPath: root }), fast);
    assert.deepEqual(res.items.map(i => [i.relPath, i.status, i.chunked]), [['big.mp4', 'created', true], ['small.mp4', 'created', false]]);
    const large = fake.calls.find(c => c.method === 'upload_large');
    assert.equal(large.args[1].chunk_size, LARGE_FILE_BYTES);
    assert.equal(large.args[1].resource_type, 'video');
    assert.equal(fake.calls.filter(c => c.method === 'upload').length, 1);
  } finally { restore(); }
});

test('chunked uploads report byte progress after each confirmed chunk (SDK stream "ready" events)', async () => {
  const { EventEmitter } = await import('node:events');
  const { backend, restore } = setup('dynamic');
  const real = cloudinary.uploader.upload_large;
  // Same contract as the SDK: returns the chunking stream, which emits `ready` per chunk, and
  // reports the result through the callback.
  cloudinary.uploader.upload_large = (file, options, cb) => {
    const stream = new EventEmitter();
    const size = fs.statSync(file).size;
    setImmediate(async () => {
      for (let sent = 0; sent < size; sent += options.chunk_size) {
        stream.emit('ready', Buffer.alloc(Math.min(options.chunk_size, size - sent)), sent + options.chunk_size >= size, () => {});
        await new Promise(r => setImmediate(r));
      }
      cb(undefined, await real(file, options));
    });
    return stream;
  };
  try {
    const root = makeTree({});
    const big = path.join(root, 'big.mp4');
    fs.writeFileSync(big, Buffer.alloc(2500));
    const seen = [];
    const res = await executeUpload(backend, planUpload({ localPath: big }), {
      ...fast, largeFileBytes: 1000, chunkBytes: 1000, onChunk: (item, sent, total) => seen.push([item.relPath, sent, total]),
    });
    assert.equal(res.items[0].status, 'created');
    assert.equal(res.items[0].chunked, true);
    assert.deepEqual(seen, [['big.mp4', 1000, 2500], ['big.mp4', 2000, 2500], ['big.mp4', 2500, 2500]]);
  } finally {
    cloudinary.uploader.upload_large = real;
    restore();
  }
});

test('concurrency is bounded and progress is reported once per file', async () => {
  const { backend, restore } = setup('dynamic');
  const real = cloudinary.uploader.upload;
  let inFlight = 0;
  let peak = 0;
  cloudinary.uploader.upload = async (...a) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    try { return await real(...a); } finally { inFlight--; }
  };
  try {
    const root = makeTree(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`f${i}.png`, i])));
    const progress = [];
    const res = await executeUpload(backend, planUpload({ localPath: root }), { ...fast, concurrency: 2, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    assert.equal(res.summary.created, 7);
    assert.equal(peak, 2);
    assert.deepEqual(progress, ['1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']);
  } finally {
    cloudinary.uploader.upload = real;
    restore();
  }
});

// ---------------------------------------------------------------- CLI

test('cli: upload --dry-run --json works without credentials and prints only JSON', async () => {
  const root = makeTree(MIXED);
  const r = await runCli(['upload', root, '-r', '--dry-run', '--json'], { credentials: false });
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.dryRun, true);
  assert.equal(data.total, 7);
  assert.ok(data.items.some(i => i.publicId === 'e.txt' && i.resourceType === 'raw'));
  assert.equal(r.calls.length, 0);
});

test('cli: created, then overwritten; --no-overwrite skipped (JSON and human output)', async () => {
  const root = makeTree({ 'hero.png': 'v1' });
  const file = path.join(root, 'hero.png');
  const first = await runCli(['upload', file, '--to', 'shots', '--json']);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).items[0].status, 'created');
  assert.equal(JSON.parse(first.stdout).items[0].publicId, 'shots/hero');

  const second = await runCli(['upload', file, 'shots/hero'], { fake: createFakeCloudinary({ state: first.state }) });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /Uploaded \(overwritten\): https:\/\/res\.cloudinary\.com\/fake-cloud\/image\/upload\/v\d+\/shots\/hero\.png/);

  const third = await runCli(['upload', file, '--to=shots', '--no-overwrite', '--json'], { fake: createFakeCloudinary({ state: second.state }) });
  assert.equal(third.code, 0, third.stderr);
  assert.equal(JSON.parse(third.stdout).items[0].status, 'skipped');
});

test('cli: partial failure in a directory upload exits 3 with progress on stderr', async () => {
  const root = makeTree({ 'a.png': 1, 'b.txt': 2 });
  // Forcing --rt=image makes the fake reject the .txt file (400 Invalid image file).
  const r = await runCli(['upload', root, '--rt=image', '--json']);
  assert.equal(r.code, 3, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.deepEqual(data.summary, { total: 2, created: 1, overwritten: 0, skipped: 0, failed: 1 });
  assert.match(r.stderr, /\[\d\/2\] created https:\/\//);
  assert.match(r.stderr, /\[\d\/2\] failed b\.txt: Invalid image file/);
});

test('cli: a failed single-file upload exits 1 with a JSON error on stderr; -v includes the raw response', async () => {
  const root = makeTree({ 'b.txt': 1, 'a.png': 1 });
  const bad = await runCli(['upload', path.join(root, 'b.txt'), '--rt', 'image', '--json']);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
  assert.match(JSON.parse(bad.stderr).error.message, /Invalid image file/);

  const missing = await runCli(['upload', path.join(root, 'nope.png')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /No such local file or directory/);

  const verbose = await runCli(['upload', path.join(root, 'a.png'), '-v', '--json']);
  assert.equal(verbose.code, 0, verbose.stderr);
  assert.equal(JSON.parse(verbose.stdout).items[0].response.public_id, 'a');
});
