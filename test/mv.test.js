import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary, configureSdk } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { CODES } from '../lib/errors.js';
import { planMove, executeMove } from '../lib/actions/move.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { runCli } from './helpers/cli.js';

function setup(t, folderMode) {
  const fake = createFakeCloudinary({ folderMode });
  t.after(installFake(cloudinary, fake));
  configureSdk({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret' });
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  const move = async (source, target, opts = {}) =>
    executeMove(backend, await planMove(backend, { cwd: 'apps', source, target, ...opts }));
  const asset = (id) => fake.state.assets.find(a => a.asset_id === id);
  return { fake, backend, move, asset };
}

const writes = (fake) => fake.calls.filter(c => ['update', 'rename', 'rename_folder', 'delete_resources', 'delete_resources_by_asset_ids'].includes(c.method));

test('dynamic: mv hero archive/ moves the folder and keeps the public ID and URL', async (t) => {
  const { fake, move, asset } = setup(t, 'dynamic');
  const hero = fake.seed({ public_id: 'apps/hero' });
  fake.seedFolder('apps/archive');

  const res = await move('hero', 'archive/');
  assert.equal(res.urlChanged, false);
  assert.equal(res.to, 'apps/archive/hero');
  const a = asset(hero.asset_id);
  assert.equal(a.public_id, 'apps/hero');
  assert.equal(a.asset_folder, 'apps/archive');
  assert.ok(!fake.calls.some(c => c.method === 'rename'));
});

test('dynamic: an existing folder as target moves into it (no trailing slash needed)', async (t) => {
  const { fake, move, asset } = setup(t, 'dynamic');
  const hero = fake.seed({ public_id: 'apps/hero' });
  fake.seedFolder('archive');
  await move('hero', '/archive');
  assert.equal(asset(hero.asset_id).asset_folder, 'archive');
  assert.equal(asset(hero.asset_id).display_name, 'hero');
});

test('dynamic: rename changes the display name only; --public-id renames the public ID', async (t) => {
  const { fake, move, asset } = setup(t, 'dynamic');
  const hero = fake.seed({ public_id: 'apps/hero' });

  const r1 = await move('hero', 'hero2');
  assert.equal(r1.urlChanged, false);
  assert.equal(asset(hero.asset_id).public_id, 'apps/hero');
  assert.equal(asset(hero.asset_id).display_name, 'hero2');

  const r2 = await move('hero2', 'hero3', { changePublicId: true });
  assert.equal(r2.urlChanged, true);
  assert.deepEqual(r2.public_id, { from: 'apps/hero', to: 'apps/hero3' });
  assert.equal(asset(hero.asset_id).public_id, 'apps/hero3');
  assert.equal(asset(hero.asset_id).display_name, 'hero3');
  assert.equal(asset(hero.asset_id).asset_folder, 'apps');
});

test('fixed: moving or renaming renames the public ID', async (t) => {
  const { fake, move, asset } = setup(t, 'fixed');
  const hero = fake.seed({ public_id: 'apps/hero' });
  fake.seedFolder('apps/archive');

  const r1 = await move('hero', 'archive/');
  assert.equal(r1.urlChanged, true);
  assert.equal(asset(hero.asset_id).public_id, 'apps/archive/hero');

  // "hero2.png" names the image hero2 (the format is not part of an image's public ID).
  const r2 = await move('archive/hero', 'hero2.png');
  assert.equal(r2.to, 'apps/hero2');
  assert.equal(asset(hero.asset_id).public_id, 'apps/hero2');
});

test('relative paths: mv sub/a sub/b resolves both under the current folder', async (t) => {
  for (const mode of ['dynamic', 'fixed']) {
    await t.test(mode, async (t2) => {
      const { fake, move, asset } = setup(t2, mode);
      const a = fake.seed({ public_id: 'apps/sub/a' });
      fake.seed({ public_id: 'sub/a' }); // same relative path at the root must not be touched
      const res = await move('sub/a', 'sub/b');
      assert.equal(res.from, 'apps/sub/a');
      assert.equal(res.to, 'apps/sub/b');
      const moved = asset(a.asset_id);
      if (mode === 'dynamic') assert.equal(moved.display_name, 'b');
      else assert.equal(moved.public_id, 'apps/sub/b');
      assert.ok(fake.state.assets.some(x => x.public_id === 'sub/a'));
    });
  }
});

test('folder move: dynamic uses rename_folder, fixed is unsupported', async (t) => {
  await t.test('dynamic rename', async (t2) => {
    const { fake, move } = setup(t2, 'dynamic');
    const a = fake.seed({ public_id: 'apps/sub/a' });
    const res = await move('sub', 'renamed');
    assert.equal(res.kind, 'folder');
    assert.deepEqual([res.from, res.to], ['apps/sub', 'apps/renamed']);
    assert.deepEqual(fake.calls.find(c => c.method === 'rename_folder').args, ['apps/sub', 'apps/renamed']);
    assert.equal(fake.state.assets.find(x => x.asset_id === a.asset_id).asset_folder, 'apps/renamed');
  });
  await t.test('dynamic into an existing folder', async (t2) => {
    const { fake, move } = setup(t2, 'dynamic');
    fake.seedFolder('apps/sub');
    fake.seedFolder('archive');
    const res = await move('sub', '/archive');
    assert.equal(res.to, 'archive/sub');
    assert.ok(fake.state.folders.includes('archive/sub'));
  });
  await t.test('dynamic into itself is refused', async (t2) => {
    const { fake, backend } = setup(t2, 'dynamic');
    fake.seedFolder('apps/sub');
    await assert.rejects(planMove(backend, { cwd: 'apps', source: 'sub', target: 'sub/' }), { code: CODES.USAGE });
  });
  await t.test('fixed', async (t2) => {
    const { fake, backend } = setup(t2, 'fixed');
    fake.seed({ public_id: 'apps/sub/a' });
    await assert.rejects(planMove(backend, { cwd: 'apps', source: 'sub', target: 'renamed' }), { code: CODES.UNSUPPORTED });
    assert.equal(writes(fake).length, 0);
  });
});

test('public ID collision: CONFLICT without overwrite, replaced with overwrite (fixed, and dynamic --public-id)', async (t) => {
  for (const mode of ['dynamic', 'fixed']) {
    await t.test(mode, async (t2) => {
      const { fake, backend, move } = setup(t2, mode);
      const hero = fake.seed({ public_id: 'apps/hero' });
      const old = fake.seed({ public_id: 'apps/archive/hero' });
      const opts = { cwd: 'apps', source: 'hero', target: 'archive/', changePublicId: mode === 'dynamic' };

      await assert.rejects(planMove(backend, opts), { code: CODES.CONFLICT });
      assert.equal(writes(fake).length, 0);

      const plan = await planMove(backend, { ...opts, overwrite: true });
      assert.equal(plan.targetExists, true);
      assert.deepEqual(plan.replaces.map(r => r.public_id), ['apps/archive/hero']);
      const res = await executeMove(backend, plan);
      assert.deepEqual(res.replaced, ['apps/archive/hero']);
      const ids = fake.state.assets.map(a => a.asset_id);
      assert.ok(ids.includes(hero.asset_id));
      assert.ok(!ids.includes(old.asset_id));
      assert.equal(fake.state.assets.length, 1);
      await move('archive/hero', 'hero', { changePublicId: mode === 'dynamic' }); // nothing in the way now
    });
  }
});

test('dynamic name clash: CONFLICT without overwrite; with overwrite both assets are kept', async (t) => {
  const { fake, backend } = setup(t, 'dynamic');
  const hero = fake.seed({ public_id: 'apps/hero' });
  const other = fake.seed({ public_id: 'apps/archive/hero' });

  await assert.rejects(planMove(backend, { cwd: 'apps', source: 'hero', target: 'archive/' }), { code: CODES.CONFLICT });
  assert.equal(writes(fake).length, 0);

  const plan = await planMove(backend, { cwd: 'apps', source: 'hero', target: 'archive/', overwrite: true });
  assert.equal(plan.targetExists, true);
  assert.deepEqual(plan.replaces, []);
  assert.deepEqual(plan.sameName.map(r => r.public_id), ['apps/archive/hero']);
  const res = await executeMove(backend, plan);
  assert.deepEqual(res.replaced, []);
  assert.match(res.warning, /2 assets named "hero"/);
  assert.ok(!fake.calls.some(c => c.method.startsWith('delete')));
  const inArchive = fake.state.assets.filter(a => a.asset_folder === 'apps/archive').map(a => a.asset_id).sort();
  assert.deepEqual(inArchive, [hero.asset_id, other.asset_id].sort());
});

test('errors: same source and target, missing parent folder, missing source', async (t) => {
  const { fake, backend } = setup(t, 'dynamic');
  fake.seed({ public_id: 'apps/hero' });
  const plan = (source, target) => planMove(backend, { cwd: 'apps', source, target });
  await assert.rejects(plan('hero', 'hero'), { code: CODES.USAGE });
  await assert.rejects(plan('hero', '.'), { code: CODES.USAGE });
  await assert.rejects(plan('hero', 'nope/hero2'), { code: CODES.NOT_FOUND });
  await assert.rejects(plan('ghost', 'x'), { code: CODES.NOT_FOUND });
  await assert.rejects(plan('hero', ''), { code: CODES.USAGE });
});

test('dry-run plan reports whether the URL changes and changes nothing', async (t) => {
  const { fake, backend } = setup(t, 'dynamic');
  fake.seed({ public_id: 'apps/hero' });
  const keep = await planMove(backend, { cwd: 'apps', source: 'hero', target: '/' });
  assert.equal(keep.urlChanged, false);
  assert.equal(keep.to, 'hero');
  const change = await planMove(backend, { cwd: 'apps', source: 'hero', target: 'hero2', changePublicId: true });
  assert.equal(change.urlChanged, true);
  assert.equal(change.targetExists, false);
  assert.equal(writes(fake).length, 0);
});

// ------------------------------------------------------------ headless CLI

test('cli: mv renders the outcome, --dry-run changes nothing', async () => {
  const fake = createFakeCloudinary({ folderMode: 'dynamic' });
  fake.seed({ public_id: 'apps/hero' });
  fake.seedFolder('archive');

  const dry = await runCli(['mv', 'apps/hero', 'archive/', '--dry-run'], { fake });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /apps\/hero -> \/archive\/hero \(URL unchanged\)/);
  assert.ok(!dry.calls.some(c => c.method === 'update'));

  const run = await runCli(['mv', 'apps/hero', 'archive/', '--json'], { fake });
  assert.equal(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.urlChanged, false);
  assert.equal(run.state.assets[0].asset_folder, 'archive');
});

test('cli: fixed-mode folder move exits 1 with UNSUPPORTED; conflicts exit 1 with CONFLICT', async () => {
  const fixed = createFakeCloudinary({ folderMode: 'fixed' });
  fixed.seed({ public_id: 'sub/a' });
  const r1 = await runCli(['mv', 'sub', 'other', '--json'], { fake: fixed });
  assert.equal(r1.code, 1);
  assert.equal(JSON.parse(r1.stderr).error.code, 'UNSUPPORTED');

  const dyn = createFakeCloudinary({ folderMode: 'dynamic' });
  dyn.seed({ public_id: 'a' });
  dyn.seed({ public_id: 'b' });
  const r2 = await runCli(['mv', 'a', 'b', '--json'], { fake: dyn });
  assert.equal(r2.code, 1);
  assert.equal(JSON.parse(r2.stderr).error.code, 'CONFLICT');
  const r3 = await runCli(['mv', 'a', 'b', '-o'], { fake: dyn });
  assert.equal(r3.code, 0, r3.stderr);
  assert.match(r3.stdout, /Moved: \/a -> \/b \(URL unchanged\)/);
  assert.equal(r3.state.assets.length, 2, 'a name clash never deletes the other asset');
  assert.match(r3.stderr, /2 assets named "b"/);
});
