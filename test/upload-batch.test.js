import test from 'node:test';
import assert from 'node:assert/strict';
import { planUploadPublicIds } from '../commands/upload.js';
import { norm, join } from '../lib/cld.js';

test('upload: planUploadPublicIds prevents collision between same basename with different extensions', () => {
  const utils = { norm, join };
  const mockFiles = [
    { fullPath: '/local/profile.jpg', relPath: 'profile.jpg' },
    { fullPath: '/local/profile.png', relPath: 'profile.png' },
    { fullPath: '/local/logo.svg', relPath: 'logo.svg' },
  ];

  const planned = planUploadPublicIds(mockFiles, 'my-folder', utils);

  assert.equal(planned.length, 3);
  // profile.jpg and profile.png should be disambiguated with _jpg and _png
  const profileJpg = planned.find(p => p.relPath === 'profile.jpg');
  const profilePng = planned.find(p => p.relPath === 'profile.png');
  const logoSvg = planned.find(p => p.relPath === 'logo.svg');

  assert.equal(profileJpg.publicId, 'my-folder/profile_jpg');
  assert.equal(profileJpg.hasCollision, true);

  assert.equal(profilePng.publicId, 'my-folder/profile_png');
  assert.equal(profilePng.hasCollision, true);

  assert.equal(logoSvg.publicId, 'my-folder/logo');
  assert.equal(logoSvg.hasCollision, false);
});

test('upload: planUploadPublicIds preserves nested directory structure', () => {
  const utils = { norm, join };
  const mockFiles = [
    { fullPath: '/local/sub/nested/hero.png', relPath: 'sub/nested/hero.png' },
  ];

  const planned = planUploadPublicIds(mockFiles, 'apps/app1', utils);
  assert.equal(planned[0].publicId, 'apps/app1/sub/nested/hero');
});
