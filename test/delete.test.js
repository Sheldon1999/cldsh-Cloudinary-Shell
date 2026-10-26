import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { CODES } from '../lib/errors.js';
import { planDelete, executeDelete, describePlan } from '../lib/actions/delete.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';

function setup(folderMode) {
  const fake = createFakeCloudinary({ folderMode });
  const restore = installFake(cloudinary, fake);
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  return { fake, backend, restore };
}

const ids = (state) => state.assets.map(a => a.public_id).sort();
const err = (http_code, message) => ({ error: { message, http_code } });

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] rm -r of 2,500 assets deletes every one and removes the folder`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      for (let i = 0; i < 2500; i++) fake.seed({ public_id: `big/${i < 2400 ? '' : 'sub/'}a${String(i).padStart(4, '0')}` });
      fake.seed({ public_id: 'keep/x' });
      const plan = await planDelete(backend, { targets: ['big'], recursive: true });
      assert.equal(plan.totals.assets, 2500);
      assert.deepEqual(plan.folders, ['big']);
      const res = await executeDelete(backend, plan);
      assert.deepEqual(res.summary, { deleted: 2500, not_found: 0, failed: 0, folders_deleted: 1, folders_failed: 0 });
      assert.deepEqual(ids(fake.state), ['keep/x']);
      assert.ok(!fake.state.folders.some(f => f === 'big' || f.startsWith('big/')));
      assert.ok(!fake.calls.some(c => c.method === 'delete_resources_by_prefix'));
    } finally { restore(); }
  });

  test(`[${mode}] recursive delete covers every resource and delivery type`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'old/img' });
      fake.seed({ public_id: 'old/clip', resource_type: 'video', format: 'mp4' });
      fake.seed({ public_id: 'old/doc.txt', resource_type: 'raw' });
      fake.seed({ public_id: 'old/secret', type: 'private' });
      fake.seed({ public_id: 'old/deep/auth', type: 'authenticated' });
      const plan = await planDelete(backend, { targets: ['old'], recursive: true });
      assert.deepEqual(plan.totals.byResourceType, { image: 3, video: 1, raw: 1 });
      assert.deepEqual(plan.totals.byDeliveryType, { upload: 3, private: 1, authenticated: 1 });
      const res = await executeDelete(backend, plan);
      assert.equal(res.summary.deleted, 5);
      assert.equal(res.summary.folders_deleted, 1);
      assert.deepEqual(fake.state.assets, []);
    } finally { restore(); }
  });

  test(`[${mode}] a public ID that only shares a prefix with the folder is not deleted`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/old/a' });
      fake.seed({ public_id: 'apps/oldies/b' });
      if (mode === 'dynamic') fake.seed({ public_id: 'apps/old/moved', asset_folder: 'elsewhere' });
      const plan = await planDelete(backend, { cwd: 'apps', targets: ['old'], recursive: true });
      await executeDelete(backend, plan);
      const left = ids(fake.state);
      assert.ok(left.includes('apps/oldies/b'));
      assert.ok(!left.includes('apps/old/a'));
      if (mode === 'dynamic') assert.ok(left.includes('apps/old/moved'));
    } finally { restore(); }
  });

  test(`[${mode}] targets resolve against the current folder`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/sub/a' });
      fake.seed({ public_id: 'sub/a' });
      fake.seed({ public_id: 'a' });
      fake.seed({ public_id: 'apps/a' });
      const p1 = await planDelete(backend, { cwd: 'apps', targets: ['sub/a'] });
      assert.deepEqual(p1.assets.map(a => a.public_id), ['apps/sub/a']);
      const p2 = await planDelete(backend, { cwd: 'apps', targets: ['../a'] });
      assert.deepEqual(p2.assets.map(a => a.public_id), ['a']);
      const p3 = await planDelete(backend, { cwd: 'apps', targets: ['/sub/a'] });
      assert.deepEqual(p3.assets.map(a => a.public_id), ['sub/a']);
      const p4 = await planDelete(backend, { cwd: 'apps', targets: ['..'], recursive: true });
      assert.equal(p4.rootWide, true);
      assert.equal(p4.totals.assets, 4);
      assert.ok(!p4.folders.includes(''));
    } finally { restore(); }
  });

  test(`[${mode}] a missing name is reported as not_found, never as deleted`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/a' });
      const plan = await planDelete(backend, { cwd: 'apps', targets: ['a', 'ghost'] });
      assert.deepEqual(plan.missing.map(m => m.path), ['apps/ghost']);
      const res = await executeDelete(backend, plan);
      assert.deepEqual(res.summary, { deleted: 1, not_found: 1, failed: 0, folders_deleted: 0, folders_failed: 0 });
      assert.equal(res.items.find(i => i.status === 'not_found').target, 'ghost');
    } finally { restore(); }
  });

  test(`[${mode}] a folder without -r is a usage error; the root needs -r`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/a' });
      await assert.rejects(planDelete(backend, { targets: ['apps'] }), (e) => e.code === CODES.USAGE && /-r/.test(e.hint));
      await assert.rejects(planDelete(backend, { targets: ['/'] }), (e) => e.code === CODES.USAGE);
      assert.equal(fake.state.assets.length, 1);
    } finally { restore(); }
  });

  test(`[${mode}] a failed folder delete is reported as failed with the reason`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'old/a' });
      fake.seedFolder('old/empty');
      const plan = await planDelete(backend, { targets: ['old'], recursive: true });
      fake.failNext('delete_folder', { error: err(400, 'Folder is not empty') });
      const res = await executeDelete(backend, plan);
      assert.equal(res.summary.deleted, 1);
      assert.equal(res.summary.folders_failed, 1);
      assert.equal(res.folders[0].status, 'failed');
      assert.match(res.folders[0].error, /Folder is not empty/);
      assert.match(res.folders[0].hint, /--skip-backup/);
    } finally { restore(); }
  });

  test(`[${mode}] --skip-backup is passed to delete_folder`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'old/a' });
      fake.seedFolder('old');
      const plan = await planDelete(backend, { targets: ['old'], recursive: true });
      await executeDelete(backend, plan, { skipBackup: true });
      const calls = fake.calls.filter(c => c.method === 'delete_folder');
      assert.ok(calls.length >= 1);
      assert.ok(calls.every(c => c.args[1].skip_backup === true));
    } finally { restore(); }
  });

  test(`[${mode}] assets that fail to delete keep their folder and are reported`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'old/a' });
      fake.seed({ public_id: 'old/b' });
      const plan = await planDelete(backend, { targets: ['old'], recursive: true });
      fake.failNext(mode === 'dynamic' ? 'delete_resources_by_asset_ids' : 'delete_resources', { error: err(500, 'boom') });
      const res = await executeDelete(backend, plan);
      assert.equal(res.summary.failed, 2);
      assert.equal(res.summary.deleted, 0);
      assert.equal(res.folders[0].status, 'failed');
      assert.ok(!fake.calls.some(c => c.method === 'delete_folder'));
      assert.equal(fake.state.assets.length, 2);
    } finally { restore(); }
  });

  test(`[${mode}] wildcards match names; -r also matches folders`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      if (mode === 'dynamic') fake.seed({ public_id: 'apps/x1y2', display_name: 'cldlogo' });
      else fake.seed({ public_id: 'apps/cldlogo' });
      fake.seed({ public_id: 'apps/other' });
      fake.seed({ public_id: 'apps/cldir/inner' });
      const flat = await planDelete(backend, { cwd: 'apps', targets: ['cld*'] });
      assert.deepEqual(flat.assets.map(a => a.name), ['cldlogo']);
      assert.deepEqual(flat.folders, []);
      const deep = await planDelete(backend, { cwd: 'apps', targets: ['cld*'], recursive: true });
      assert.deepEqual(deep.assets.map(a => a.name).sort(), ['cldlogo', 'inner']);
      assert.deepEqual(deep.folders, ['apps/cldir']);
      assert.equal(deep.rootWide, false);
      const none = await planDelete(backend, { cwd: 'apps', targets: ['zz*'] });
      assert.equal(none.missing.length, 1);
    } finally { restore(); }
  });

  test(`[${mode}] rm -r * at the root is root-wide and never deletes the root itself`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'top' });
      fake.seed({ public_id: 'apps/a' });
      const plan = await planDelete(backend, { targets: ['*'], recursive: true });
      assert.equal(plan.rootWide, true);
      assert.deepEqual(plan.folders, ['apps']);
      await executeDelete(backend, plan);
      assert.deepEqual(fake.state.assets, []);
    } finally { restore(); }
  });

  test(`[${mode}] a filtered recursive delete keeps the folder and the other types`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'old/img' });
      fake.seed({ public_id: 'old/clip', resource_type: 'video', format: 'mp4' });
      const plan = await planDelete(backend, { targets: ['old'], recursive: true, resourceTypes: ['image'] });
      assert.deepEqual(plan.folders, []);
      const res = await executeDelete(backend, plan);
      assert.equal(res.summary.deleted, 1);
      assert.deepEqual(ids(fake.state), ['old/clip']);
    } finally { restore(); }
  });
}

test('overlapping targets are planned once', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'old/a' });
    fake.seed({ public_id: 'old/sub/b' });
    const plan = await planDelete(backend, { targets: ['old', 'old/sub', 'old/a'], recursive: true });
    assert.equal(plan.totals.assets, 2);
    assert.deepEqual(plan.folders, ['old']);
  } finally { restore(); }
});

test('describePlan names the cloud, counts and the first entries', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    for (let i = 0; i < 15; i++) fake.seed({ public_id: `old/a${String(i).padStart(2, '0')}` });
    const plan = await planDelete(backend, { targets: ['old', 'ghost'], recursive: true });
    const lines = describePlan(plan, { limit: 10 });
    assert.match(lines[0], /15 asset\(s\).*1 folder\(s\).*"fake-cloud"/);
    assert.ok(lines.some(l => /and 6 more/.test(l)));
    assert.ok(lines.some(l => /not found: ghost/.test(l)));
  } finally { restore(); }
});
