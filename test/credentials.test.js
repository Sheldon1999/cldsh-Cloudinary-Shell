import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {
  parseCloudinaryUrl,
  maskSecret,
  saveProfile,
  loadCredentialsStore,
  getProfile,
  removeProfile,
  setCurrentProfile,
} from '../lib/credentials.js';

test('credentials: parseCloudinaryUrl parses valid URLs', () => {
  const parsed = parseCloudinaryUrl('cloudinary://123456:mysecret@my_cloud_name');
  assert.equal(parsed.api_key, '123456');
  assert.equal(parsed.api_secret, 'mysecret');
  assert.equal(parsed.cloud_name, 'my_cloud_name');
  // Handles prefix like CLOUDINARY_URL= and export
  const prefixed = parseCloudinaryUrl('CLOUDINARY_URL=cloudinary://123456:mysecret@my_cloud_name');
  assert.equal(prefixed.api_key, '123456');
  assert.equal(prefixed.cloud_name, 'my_cloud_name');

  const exported = parseCloudinaryUrl('export CLOUDINARY_URL="cloudinary://123456:mysecret@my_cloud_name"');
  assert.equal(exported.api_key, '123456');
  assert.equal(exported.cloud_name, 'my_cloud_name');

  assert.equal(parseCloudinaryUrl('invalid_url'), null);
});

test('credentials: maskSecret obfuscates secret', () => {
  assert.equal(maskSecret('abcdef123456'), '********3456');
  assert.equal(maskSecret('1234'), '****');
  assert.equal(maskSecret(''), '');
});

test('credentials: profile management and 0600 file permissions', () => {
  const tmpDir = path.join(os.tmpdir(), `cldsh_cred_test_${Date.now()}`);
  const tmpFile = path.join(tmpDir, 'credentials.json');

  try {
    saveProfile('default', {
      cloud_name: 'test-dev',
      api_key: 'key-1',
      api_secret: 'secret-1',
    }, true, tmpFile);

    saveProfile('prod', {
      cloud_name: 'test-prod',
      api_key: 'key-2',
      api_secret: 'secret-2',
    }, false, tmpFile);

    // Verify file exists
    assert.ok(fs.existsSync(tmpFile));

    // Verify POSIX file permissions (0600)
    if (process.platform !== 'win32') {
      const fileMode = fs.statSync(tmpFile).mode & 0o777;
      assert.equal(fileMode, 0o600);
      const dirMode = fs.statSync(tmpDir).mode & 0o777;
      assert.equal(dirMode, 0o700);
    }

    // Verify stored profiles
    const store = loadCredentialsStore(tmpFile);
    assert.equal(store.current_profile, 'default');
    assert.equal(getProfile('default', store).cloud_name, 'test-dev');
    assert.equal(getProfile('prod', store).cloud_name, 'test-prod');

    // Switch current profile
    setCurrentProfile('prod', tmpFile);
    const updated = loadCredentialsStore(tmpFile);
    assert.equal(updated.current_profile, 'prod');

    // Delete profile
    const removed = removeProfile('default', tmpFile);
    assert.equal(removed, true);
    const finalStore = loadCredentialsStore(tmpFile);
    assert.equal(finalStore.profiles.default, undefined);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});
