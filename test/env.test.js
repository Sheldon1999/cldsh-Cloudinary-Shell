import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { tempDir } from './helpers/cli.js';

// Never fall back to the developer's real credentials store or environment.
process.env.HOME = tempDir('cldsh-home-');
process.env.USERPROFILE = process.env.HOME;
for (const k of ['CLOUDINARY_URL', 'CLOUDINARY_PROFILE', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[k];

const { saveProfile, loadCredentialsStore, saveCredentialsStore } = await import('../lib/credentials.js');
const { loadEnvAndConfig, resolveSources, getActiveConfig, setSessionProfile, isConfigured } = await import('../lib/env.js');
const { cloudinary } = await import('../lib/sdk.js');
const { CODES } = await import('../lib/errors.js');

const url = (cloud, query = '') => `cloudinary://key-${cloud}:secret-${cloud}@${cloud}${query}`;
const trio = (cloud) => ({ CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: `key-${cloud}`, CLOUDINARY_API_SECRET: `secret-${cloud}` });
const creds = (cloud) => ({ cloud_name: cloud, api_key: `key-${cloud}`, api_secret: `secret-${cloud}` });

/** A world with the given sources present. */
function world({ explicit = false, envUrl = false, envTrio = false, dotUrl = false, dotTrio = false, storeDefault = false, profileEnv = false } = {}) {
  const dir = tempDir('cldsh-env-');
  const cwd = path.join(dir, 'project');
  fs.mkdirSync(cwd);
  const storePath = path.join(dir, 'config', 'credentials.json');
  saveProfile('chosen', creds('explicit'), false, storePath);
  // The first saved profile becomes the default; this world wants none unless asked.
  saveCredentialsStore({ ...loadCredentialsStore(storePath), current_profile: null }, storePath);
  if (storeDefault) saveProfile('saved', creds('store-default'), true, storePath);
  const env = {};
  if (envUrl) env.CLOUDINARY_URL = url('env-url');
  if (envTrio) Object.assign(env, trio('env-trio'));
  if (profileEnv) env.CLOUDINARY_PROFILE = 'chosen';
  const lines = [];
  if (dotUrl) lines.push(`CLOUDINARY_URL="${url('dot-url')}"`);
  if (dotTrio) lines.push(...Object.entries(trio('dot-trio')).map(([k, v]) => `${k}=${v}`));
  if (lines.length) fs.writeFileSync(path.join(cwd, '.env'), `# project\n${lines.join('\n')}\n`);
  return { env, cwd, storePath, profileName: explicit ? 'chosen' : null };
}

const ORDER = [
  ['explicit', 'explicit'],
  ['envUrl', 'env-url'],
  ['envTrio', 'env-trio'],
  ['dotUrl', 'dot-url'],
  ['dotTrio', 'dot-trio'],
  ['storeDefault', 'store-default'],
];

test('precedence: every combination of sources picks the strongest present', () => {
  for (let mask = 0; mask < 1 << ORDER.length; mask++) {
    const present = Object.fromEntries(ORDER.map(([k], i) => [k, Boolean(mask & (1 << i))]));
    const expected = ORDER.filter(([k]) => present[k]).map(([, cloud]) => cloud);
    const { winner, shadowed } = resolveSources(world(present));
    const label = JSON.stringify(present);
    assert.equal(winner?.cloud_name ?? null, expected[0] ?? null, label);
    assert.deepEqual(shadowed.map(s => s.cloud_name), expected.slice(1), label);
  }
});

test('precedence: CLOUDINARY_PROFILE and the session choice are explicit choices', () => {
  const w = world({ profileEnv: true, envUrl: true, dotUrl: true, storeDefault: true });
  assert.equal(resolveSources(w).winner.cloud_name, 'explicit');
  assert.equal(resolveSources(w).winner.source, 'profile "chosen" (CLOUDINARY_PROFILE)');

  const s = world({ envUrl: true, dotUrl: true, storeDefault: true });
  saveProfile('other', creds('session'), false, s.storePath);
  setSessionProfile('other');
  try {
    const r = resolveSources(s);
    assert.equal(r.winner.cloud_name, 'session');
    assert.equal(r.winner.profile, 'other');
    assert.deepEqual(r.shadowed.map(x => x.cloud_name), ['env-url', 'dot-url', 'store-default']);
    // The session choice beats CLOUDINARY_PROFILE; --profile beats both.
    assert.equal(resolveSources({ ...s, env: { ...s.env, CLOUDINARY_PROFILE: 'chosen' } }).winner.cloud_name, 'session');
    assert.equal(resolveSources({ ...s, profileName: 'chosen' }).winner.cloud_name, 'explicit');
    // A fresh start ignores the session choice.
    assert.equal(resolveSources({ ...s, ignoreSession: true }).winner.cloud_name, 'env-url');
  } finally {
    setSessionProfile(null);
  }
});

test('precedence: explicit profile that cannot be used never falls back to another account', () => {
  const w = world({ envUrl: true, storeDefault: true });
  assert.throws(() => resolveSources({ ...w, profileName: 'missing' }), (e) => e.code === CODES.NOT_FOUND);

  const r = loadEnvAndConfig({ ...w, env: { ...w.env, CLOUDINARY_PROFILE: 'missing' } });
  assert.equal(r.configured, false);
  assert.equal(isConfigured(), false);
  assert.match(r.warnings.join('\n'), /CLOUDINARY_PROFILE.*not saved/);
});

test('shadowed sources and warnings name both clouds', () => {
  const r = loadEnvAndConfig(world({ dotUrl: true, storeDefault: true }));
  assert.equal(r.configured, true);
  assert.equal(r.cloud_name, 'dot-url');
  assert.equal(r.profile, 'local');
  assert.deepEqual(r.shadowed, [{ source: 'saved default profile "saved"', profile: 'saved', cloud_name: 'store-default' }]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /profile "saved" \(cloud store-default\) is overridden by \.env.*\(cloud dot-url\)/);
  assert.deepEqual(getActiveConfig().shadowed, r.shadowed);

  // Same account in two places: listed, but no warning.
  const same = world({ storeDefault: true });
  same.env.CLOUDINARY_URL = url('store-default');
  const r2 = loadEnvAndConfig(same);
  assert.equal(r2.shadowed.length, 1);
  assert.deepEqual(r2.warnings, []);
});

test('an invalid CLOUDINARY_URL is ignored with a warning', () => {
  const w = world({ dotUrl: true });
  w.env.CLOUDINARY_URL = 'cloudinary://nope';
  const r = loadEnvAndConfig(w);
  assert.equal(r.cloud_name, 'dot-url');
  assert.match(r.warnings.join('\n'), /CLOUDINARY_URL environment variable .*not a valid/);
});

test('a corrupt store becomes a warning, keeps env sources working, and is left untouched', () => {
  const w = world({ envUrl: true });
  fs.writeFileSync(w.storePath, '{ broken');
  const r = loadEnvAndConfig(w);
  assert.equal(r.configured, true);
  assert.equal(r.cloud_name, 'env-url');
  assert.match(r.warnings.join('\n'), new RegExp(`Cannot read the credentials file ${w.storePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.throws(() => loadEnvAndConfig({ ...w, profileName: 'chosen' }), (e) => e.code === CODES.LOCAL);
  assert.equal(fs.readFileSync(w.storePath, 'utf8'), '{ broken');

  const none = loadEnvAndConfig({ ...w, env: {} });
  assert.equal(none.configured, false);
  assert.equal(none.warnings.length, 1);
});

test('URL options reach the SDK configuration and do not leak to the next account', () => {
  const w = world();
  w.env.CLOUDINARY_URL = url('eu-cloud', '?upload_prefix=https://api-eu.cloudinary.com');
  const r = loadEnvAndConfig(w);
  assert.equal(r.cloud_name, 'eu-cloud');
  assert.deepEqual(getActiveConfig().options, { upload_prefix: 'https://api-eu.cloudinary.com' });
  assert.equal(cloudinary.config().upload_prefix, 'https://api-eu.cloudinary.com');
  assert.equal(cloudinary.config().cloud_name, 'eu-cloud');
  assert.equal(cloudinary.config().api_secret, 'secret-eu-cloud');
  // The SDK builds Admin API request URLs from upload_prefix.
  assert.ok(cloudinary.utils.api_url('ping').startsWith('https://api-eu.cloudinary.com/v1_1/eu-cloud/'));

  // Options saved in a profile are applied too.
  saveProfile('eu', { ...creds('eu-profile'), options: { upload_prefix: 'https://api-ap.cloudinary.com' } }, false, w.storePath);
  loadEnvAndConfig({ ...w, profileName: 'eu' });
  assert.equal(cloudinary.config().upload_prefix, 'https://api-ap.cloudinary.com');

  loadEnvAndConfig({ ...w, env: { CLOUDINARY_URL: url('plain') } });
  assert.equal(cloudinary.config().cloud_name, 'plain');
  assert.equal(cloudinary.config().upload_prefix, undefined);

  loadEnvAndConfig({ ...w, env: {}, storePath: path.join(w.cwd, 'no-store.json') });
  assert.equal(getActiveConfig(), null);
  assert.equal(cloudinary.config().cloud_name, undefined);
});
