import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary, configureSdk } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { CODES } from '../lib/errors.js';
import { actionUrl } from '../lib/actions/url.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { runCli } from './helpers/cli.js';

function setup(t, folderMode = 'dynamic') {
  const fake = createFakeCloudinary({ folderMode });
  t.after(installFake(cloudinary, fake));
  configureSdk({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret' });
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  const url = (targets, opts = {}) => actionUrl(backend, { cwd: 'apps', targets: [].concat(targets), ...opts });
  return { fake, url };
}

test('unsigned URLs without a transformation equal the asset secure_url (both modes, every resource type)', async (t) => {
  for (const mode of ['dynamic', 'fixed']) {
    await t.test(mode, async (t2) => {
      const { fake, url } = setup(t2, mode);
      const image = fake.seed({ public_id: 'apps/hero', format: 'jpg' });
      const video = fake.seed({ public_id: 'apps/clip', resource_type: 'video', format: 'mp4' });
      const raw = fake.seed({ public_id: 'apps/notes.txt', resource_type: 'raw' });
      // The video is found by name without --rt.
      assert.equal((await url('hero')).items[0].url, image.secure_url);
      assert.equal((await url('clip')).items[0].url, video.secure_url);
      assert.equal((await url('notes.txt')).items[0].url, raw.secure_url);
      assert.equal((await url('/apps/hero')).items[0].url, image.secure_url);
    });
  }
});

test('--t inserts the transformation in front of the version', async (t) => {
  const { fake, url } = setup(t);
  const hero = fake.seed({ public_id: 'apps/hero' });
  const res = await url('hero', { transformation: '/w_300,c_fill/e_grayscale/' });
  assert.equal(res.items[0].url, `https://res.cloudinary.com/fake-cloud/image/upload/w_300,c_fill/e_grayscale/v${hero.version}/apps/hero.png`);
});

test('--signed signs authenticated assets (found without --type); private originals get a download URL', async (t) => {
  const { fake, url } = setup(t);
  fake.seed({ public_id: 'apps/secret', type: 'authenticated' });
  fake.seed({ public_id: 'apps/hidden', type: 'private' });

  const auth = (await url('secret', { signed: true })).items[0];
  assert.equal(auth.type, 'authenticated');
  assert.match(auth.url, /\/image\/authenticated\/s--[\w-]{8}--\/v\d+\/apps\/secret\.png$/);

  const withT = (await url('secret', { signed: true, transformation: 'w_100' })).items[0].url;
  assert.match(withT, /\/image\/authenticated\/s--[\w-]{8}--\/w_100\/v\d+\/apps\/secret\.png$/);

  const priv = (await url('hidden', { signed: true })).items[0].url;
  assert.match(priv, /^https:\/\/api\.cloudinary\.com\/v1_1\/fake-cloud\/image\/download\?/);
  assert.match(priv, /public_id=apps%2Fhidden/);
  assert.match(priv, /signature=/);

  const privT = (await url('hidden', { transformation: 'w_100' })).items[0].url;
  assert.match(privT, /\/image\/private\/w_100\/v\d+\/apps\/hidden\.png$/);
});

test('wildcards and several targets; failures are reported per target', async (t) => {
  const { fake, url } = setup(t);
  fake.seed({ public_id: 'apps/hero' });
  fake.seed({ public_id: 'apps/hello' });
  fake.seed({ public_id: 'apps/other' });

  const glob = await url('he*');
  assert.deepEqual(glob.items.map(i => i.public_id).sort(), ['apps/hello', 'apps/hero']);

  const many = await url(['hero', 'ghost', 'other']);
  assert.deepEqual(many.items.map(i => i.public_id), ['apps/hero', 'apps/other']);
  assert.equal(many.failed.length, 1);
  assert.equal(many.failed[0].target, 'ghost');
  assert.equal(many.failed[0].code, CODES.NOT_FOUND);

  await assert.rejects(url('ghost'), { code: CODES.NOT_FOUND });
  await assert.rejects(url('zz*'), { code: CODES.NOT_FOUND });
  await assert.rejects(url([]), { code: CODES.USAGE });
});

test('cli: one target prints the bare URL, several print "public_id: url", partial failure exits 3', async () => {
  const fake = createFakeCloudinary();
  const hero = fake.seed({ public_id: 'apps/hero' });
  fake.seed({ public_id: 'apps/clip', resource_type: 'video', format: 'mp4' });

  const one = await runCli(['url', 'apps/hero'], { fake });
  assert.equal(one.code, 0, one.stderr);
  assert.equal(one.stdout.trim(), hero.secure_url);

  const two = await runCli(['url', 'apps/hero', 'apps/clip', 'apps/ghost'], { fake });
  assert.equal(two.code, 3);
  const lines = two.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('apps/clip: https://res.cloudinary.com/fake-cloud/video/upload/'));
  assert.match(two.stderr, /apps\/ghost/);
});
