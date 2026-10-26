import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary } from '../lib/sdk.js';
import { Backend, detectFolderMode } from '../lib/backend/index.js';
import { CODES } from '../lib/errors.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';

function setup(folderMode) {
  const fake = createFakeCloudinary({ folderMode });
  const restore = installFake(cloudinary, fake);
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  return { fake, backend, restore };
}

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] detectFolderMode reads the product environment config`, async () => {
    const { restore } = setup(mode);
    try {
      assert.equal(await detectFolderMode(), mode);
    } finally { restore(); }
  });

  test(`[${mode}] listFolders pages past the first result page`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      for (let i = 0; i < 1203; i++) fake.seedFolder(`big/f${String(i).padStart(4, '0')}`);
      const names = await backend.listFolders('big');
      assert.equal(names.length, 1203);
      assert.ok(fake.calls.filter(c => c.method === 'sub_folders').length >= 3);
    } finally { restore(); }
  });

  test(`[${mode}] listAssets returns every resource type, immediate children only`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/hero' });
      fake.seed({ public_id: 'apps/clip', resource_type: 'video', format: 'mp4' });
      fake.seed({ public_id: 'apps/notes.txt', resource_type: 'raw' });
      fake.seed({ public_id: 'apps/deep/x' });
      const { assets } = await backend.listAssets('apps');
      assert.deepEqual(assets.map(a => `${a.resource_type}:${a.name}`).sort(), ['image:hero', 'raw:notes.txt', 'video:clip']);
    } finally { restore(); }
  });

  test(`[${mode}] resolveAsset: relative path, extension, not found`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/sub/a' });
      assert.equal((await backend.resolveAsset('apps', 'sub/a')).public_id, 'apps/sub/a');
      assert.equal((await backend.resolveAsset('apps/sub', 'a.png')).public_id, 'apps/sub/a');
      await assert.rejects(backend.resolveAsset('apps', 'ghost'), (e) => e.code === CODES.NOT_FOUND);
    } finally { restore(); }
  });

  test(`[${mode}] deleteAssets reports deleted and not_found per asset`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      const a = fake.seed({ public_id: 'apps/a' });
      const ghost = { ...a, asset_id: 'missing', public_id: 'apps/ghost' };
      const refs = [(await backend.listAssets('apps')).assets[0], { ...ghost, folder: 'apps', name: 'ghost' }];
      const results = await backend.deleteAssets(refs);
      assert.deepEqual(results.map(r => [r.ref.public_id, r.status]), [['apps/a', 'deleted'], ['apps/ghost', 'not_found']]);
    } finally { restore(); }
  });

  test(`[${mode}] Admin API errors surface as readable errors, not swallowed`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.failNext('sub_folders', { error: { error: { message: 'api_secret mismatch', http_code: 401 } } });
      await assert.rejects(backend.folderExists('apps/x'), (e) => e.code === CODES.AUTH && e.message === 'api_secret mismatch');
    } finally { restore(); }
  });
}

test('[dynamic] folder contents come from asset_folder, not the public ID path', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'random-id-123', asset_folder: 'apps', display_name: 'banner' });
    fake.seed({ public_id: 'apps/moved', asset_folder: 'archive' });
    const apps = (await backend.listAssets('apps')).assets.map(a => a.name);
    const archive = (await backend.listAssets('archive')).assets.map(a => a.public_id);
    assert.deepEqual(apps, ['banner']);
    assert.deepEqual(archive, ['apps/moved']);
    assert.equal((await backend.resolveAsset('', 'apps/banner')).public_id, 'random-id-123');
  } finally { restore(); }
});

test('[dynamic] the same name for an image and a video is a conflict unless --rt narrows it', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'apps/intro' });
    fake.seed({ public_id: 'apps/intro', resource_type: 'video', format: 'mp4' });
    await assert.rejects(backend.resolveAsset('apps', 'intro'), (e) => e.code === CODES.CONFLICT && e.details.length === 2);
    assert.equal((await backend.resolveAsset('apps', 'intro', { resourceType: 'video' })).resource_type, 'video');
  } finally { restore(); }
});

test('[dynamic] moveAsset to another folder keeps the public ID (URL unchanged)', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'apps/hero' });
    fake.seedFolder('archive');
    const ref = await backend.resolveAsset('apps', 'hero');
    const res = await backend.moveAsset(ref, { toFolder: 'archive' });
    assert.equal(res.urlChanged, false);
    assert.equal(res.after.public_id, 'apps/hero');
    assert.equal(res.after.folder, 'archive');
  } finally { restore(); }
});

test('[fixed] moveAsset renames the public ID', async () => {
  const { fake, backend, restore } = setup('fixed');
  try {
    fake.seed({ public_id: 'apps/hero' });
    const ref = await backend.resolveAsset('apps', 'hero');
    const res = await backend.moveAsset(ref, { toFolder: 'archive' });
    assert.equal(res.urlChanged, true);
    assert.equal(res.after.public_id, 'archive/hero');
  } finally { restore(); }
});

test('[fixed] renaming folders is unsupported', async () => {
  const { fake, backend, restore } = setup('fixed');
  try {
    fake.seed({ public_id: 'apps/hero' });
    await assert.rejects(backend.renameFolder('apps', 'apps2'), (e) => e.code === CODES.UNSUPPORTED);
  } finally { restore(); }
});

test('listing is cached until a write invalidates it', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seedFolder('apps');
    await backend.listFolders('');
    await backend.listFolders('');
    assert.equal(fake.calls.filter(c => c.method === 'root_folders').length, 1);
    await backend.createFolder('other');
    assert.deepEqual(await backend.listFolders(''), ['apps', 'other']);
  } finally { restore(); }
});

test('rate limit is tracked from responses', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.setRateRemaining(40);
    await backend.listFolders('');
    assert.equal(backend.rate.remaining, 39);
    assert.equal(backend.rateLow, true);
  } finally { restore(); }
});
