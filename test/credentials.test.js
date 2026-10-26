import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  parseCloudinaryUrl,
  maskSecret,
  saveProfile,
  loadCredentialsStore,
  getProfile,
  removeProfile,
  setCurrentProfile,
  backupCredentialsStore,
} from '../lib/credentials.js';
import { CODES } from '../lib/errors.js';
import { tempDir } from './helpers/cli.js';

const posix = process.platform !== 'win32';
const storeIn = () => path.join(tempDir('cldsh-cred-'), 'cldsh', 'credentials.json');
const A = { cloud_name: 'cloud-a', api_key: 'key-a', api_secret: 'secret-a' };
const B = { cloud_name: 'cloud-b', api_key: 'key-b', api_secret: 'secret-b' };

test('parseCloudinaryUrl: plain, exported and quoted forms', () => {
  for (const s of [
    'cloudinary://123456:mysecret@my_cloud',
    'CLOUDINARY_URL=cloudinary://123456:mysecret@my_cloud',
    'export CLOUDINARY_URL="cloudinary://123456:mysecret@my_cloud"',
    "  'cloudinary://123456:mysecret@my_cloud'  ",
  ]) {
    assert.deepEqual(parseCloudinaryUrl(s), { cloud_name: 'my_cloud', api_key: '123456', api_secret: 'mysecret', options: {} }, s);
  }
});

test('parseCloudinaryUrl: query options, private CDN path, percent-decoding', () => {
  const p = parseCloudinaryUrl('cloudinary://k%2B1:s%40cr%2Fet@c1/cdn.example.com?upload_prefix=https://api-eu.cloudinary.com&cname=img.example.com');
  assert.equal(p.api_key, 'k+1');
  assert.equal(p.api_secret, 's@cr/et');
  assert.equal(p.cloud_name, 'c1');
  assert.deepEqual(p.options, {
    private_cdn: true,
    secure_distribution: 'cdn.example.com',
    upload_prefix: 'https://api-eu.cloudinary.com',
    cname: 'img.example.com',
  });
});

test('parseCloudinaryUrl: rejects incomplete or foreign URLs', () => {
  for (const s of ['', 'invalid_url', 'https://k:s@c', 'cloudinary://k@c', 'cloudinary://:s@c', 'cloudinary://k:s@', 'account://k:s@c']) {
    assert.equal(parseCloudinaryUrl(s), null, s);
  }
});

test('maskSecret keeps only the last 4 characters', () => {
  assert.equal(maskSecret('abcdef123456'), '********3456');
  assert.equal(maskSecret('1234'), '****');
  assert.equal(maskSecret(''), '');
});

test('store: profiles, options and 0600/0700 permissions, version 2', () => {
  const file = storeIn();
  saveProfile('default', A, true, file);
  saveProfile('prod', { ...B, options: { upload_prefix: 'https://api-eu.cloudinary.com' } }, false, file);
  if (posix) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  }
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, 2);
  const store = loadCredentialsStore(file);
  assert.equal(store.current_profile, 'default');
  assert.equal(getProfile('prod', store).options.upload_prefix, 'https://api-eu.cloudinary.com');
  assert.equal(getProfile('default', store).options, undefined);
  setCurrentProfile('prod', file);
  assert.equal(loadCredentialsStore(file).current_profile, 'prod');
  assert.throws(() => setCurrentProfile('nope', file), (e) => e.code === CODES.NOT_FOUND);
});

test('store: existing loose permissions are tightened on load', { skip: !posix }, () => {
  const file = storeIn();
  saveProfile('default', A, true, file);
  fs.chmodSync(file, 0o644);
  loadCredentialsStore(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('store: version 1 is migrated (dangling current_profile dropped)', () => {
  const file = storeIn();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ current_profile: 'default', profiles: { prod: B } }));
  const store = loadCredentialsStore(file);
  assert.equal(store.version, 2);
  assert.equal(store.current_profile, null);
  assert.deepEqual(store.profiles.prod, B);

  fs.writeFileSync(file, JSON.stringify({ current_profile: 'prod', profiles: { prod: B } }));
  assert.equal(loadCredentialsStore(file).current_profile, 'prod');
  saveProfile('dev', A, false, file);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.version, 2);
  assert.deepEqual(Object.keys(written.profiles).sort(), ['dev', 'prod']);
  assert.equal(written.current_profile, 'prod');
});

test('store: corrupt or newer files are never overwritten', () => {
  for (const content of ['{ not json', '[]', JSON.stringify({ version: 3, profiles: {} }), JSON.stringify({ profiles: { x: 'oops' } })]) {
    const file = storeIn();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    assert.throws(() => loadCredentialsStore(file), (e) => e.code === CODES.LOCAL && e.message.includes(file));
    assert.throws(() => saveProfile('default', A, true, file), (e) => e.code === CODES.LOCAL);
    assert.throws(() => removeProfile('x', file), (e) => e.code === CODES.LOCAL);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('store: a failed write leaves the old file intact and no temp files', () => {
  const file = storeIn();
  saveProfile('default', A, true, file);
  const before = fs.readFileSync(file, 'utf8');
  for (const fn of ['fsyncSync', 'renameSync', 'writeFileSync']) {
    const real = fs[fn];
    fs[fn] = (...args) => {
      if (typeof args[0] === 'number' || String(args[0]).endsWith('.tmp')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return real(...args);
    };
    try {
      assert.throws(() => saveProfile('prod', B, true, file), (e) => e.code === CODES.LOCAL);
    } finally {
      fs[fn] = real;
    }
    assert.equal(fs.readFileSync(file, 'utf8'), before, fn);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.json'], fn);
  }
});

test('store: removing the saved default clears it instead of switching', () => {
  const file = storeIn();
  saveProfile('a', A, true, file);
  saveProfile('b', B, false, file);
  assert.equal(removeProfile('a', file), true);
  const store = loadCredentialsStore(file);
  assert.equal(store.current_profile, null);
  assert.deepEqual(Object.keys(store.profiles), ['b']);
  assert.equal(removeProfile('a', file), false);
  assert.equal(removeProfile('__proto__', file), false);
});

test('store: backup moves the file aside without clobbering older backups', () => {
  const file = storeIn();
  assert.equal(backupCredentialsStore(file), null);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'first');
  assert.equal(backupCredentialsStore(file), `${file}.bak`);
  fs.writeFileSync(file, 'second');
  assert.equal(backupCredentialsStore(file), `${file}.bak.1`);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), 'first');
  assert.equal(fs.existsSync(file), false);
});
