import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary, configureSdk } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { renderItermImage, isTerminalGraphicsSupported, previewUrl } from '../commands/view.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { runCli } from './helpers/cli.js';

test('view: renderItermImage generates an OSC 1337 inline image sequence', () => {
  const buf = Buffer.from('test-image-data');
  const rendered = renderItermImage(buf, { width: 'auto' });
  assert.ok(rendered.startsWith('\u001B]1337;File=inline=1;width=auto'));
  assert.ok(rendered.includes(`:${buf.toString('base64')}\u0007`));
});

test('view: isTerminalGraphicsSupported follows the terminal environment', (t) => {
  const saved = { TERM_PROGRAM: process.env.TERM_PROGRAM, LC_TERMINAL: process.env.LC_TERMINAL, GHOSTTY_RESOURCES_DIR: process.env.GHOSTTY_RESOURCES_DIR };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.TERM_PROGRAM = 'Apple_Terminal';
  assert.equal(isTerminalGraphicsSupported(), false);
  process.env.TERM_PROGRAM = 'iTerm.app';
  assert.equal(isTerminalGraphicsSupported(), true);
  delete process.env.TERM_PROGRAM;
  process.env.LC_TERMINAL = 'iTerm2';
  assert.equal(isTerminalGraphicsSupported(), true);
});

test('view: preview URLs are built by the SDK (user transformation first, videos as a PNG frame)', (t) => {
  const fake = createFakeCloudinary();
  t.after(installFake(cloudinary, fake));
  configureSdk({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret' });
  const backend = new Backend({ mode: 'dynamic', cloudName: 'fake-cloud' });
  const img = { public_id: 'apps/hero', resource_type: 'image', type: 'upload', format: 'jpg', version: 7 };
  const vid = { public_id: 'apps/clip', resource_type: 'video', type: 'upload', format: 'mp4', version: 8 };
  const base = 'https://res.cloudinary.com/fake-cloud';
  assert.equal(previewUrl(backend, img), `${base}/image/upload/w_600,c_limit,q_auto/v7/apps/hero.png`);
  assert.equal(previewUrl(backend, img, 'e_grayscale'), `${base}/image/upload/e_grayscale/w_600,c_limit,q_auto/v7/apps/hero.png`);
  assert.equal(previewUrl(backend, vid), `${base}/video/upload/so_0/w_600,c_limit,q_auto/v8/apps/clip.png`);
  assert.match(previewUrl(backend, { ...img, type: 'authenticated' }), /\/image\/authenticated\/s--[\w-]{8}--\/w_600/);
});

test('cli: view and preview print the preview URL when output is not a terminal; videos need no --rt', async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'apps/clip', resource_type: 'video', format: 'mp4' });
  fake.seed({ public_id: 'apps/notes.txt', resource_type: 'raw' });

  const res = await runCli(['view', 'apps/clip'], { fake, env: { TERM_PROGRAM: 'iTerm.app' } });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout.trim(), /^https:\/\/res\.cloudinary\.com\/fake-cloud\/video\/upload\/so_0\/w_600,c_limit,q_auto\/v\d+\/apps\/clip\.png$/);
  assert.ok(!res.stdout.includes('\u001B]1337'));

  const alias = await runCli(['preview', 'apps/clip', '--json'], { fake });
  assert.equal(alias.code, 0, alias.stderr);
  assert.equal(JSON.parse(alias.stdout).resource_type, 'video');

  const raw = await runCli(['view', 'apps/notes.txt'], { fake });
  assert.equal(raw.code, 2);
});

test('cli: open prints the URL instead of launching a browser when output is not a terminal', async () => {
  const fake = createFakeCloudinary();
  const hero = fake.seed({ public_id: 'apps/hero' });
  const res = await runCli(['open', 'apps/hero', '--json'], { fake });
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.launched, false);
  assert.equal(out.url, hero.secure_url);

  const plain = await runCli(['open', 'apps/hero', '--t', 'w_100'], { fake });
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout.trim(), /\/image\/upload\/w_100\/v\d+\/apps\/hero\.png$/);

  const missing = await runCli(['open', 'apps/ghost'], { fake });
  assert.equal(missing.code, 1);
});
