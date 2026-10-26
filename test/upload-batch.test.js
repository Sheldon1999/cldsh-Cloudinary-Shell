// planUpload is offline: public IDs, resource types, folders and collisions are decided locally.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planUpload } from '../lib/actions/upload.js';
import { classifyFile } from '../lib/filetypes.js';
import { CODES } from '../lib/errors.js';
import { tempDir } from './helpers/cli.js';

function makeTree(files) {
  const root = tempDir('cldsh-up-');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content ?? 'x'));
  }
  return root;
}

const byRel = (plan) => Object.fromEntries(plan.items.map(i => [i.relPath, i]));

test('classifyFile: images (incl. pdf/svg), video+audio, everything else raw', () => {
  for (const f of ['a.png', 'b.JPG', 'c.pdf', 'd.svg', 'e.gif', 'f.webp', 'g.avif', 'h.heic', 'i.tiff', 'j.bmp', 'k.ico']) assert.equal(classifyFile(f), 'image', f);
  for (const f of ['a.mp4', 'b.MOV', 'c.webm', 'd.mp3', 'e.wav', 'f.m4a', 'g.flac']) assert.equal(classifyFile(f), 'video', f);
  for (const f of ['a.txt', 'b.json', 'c.zip', 'd', 'e.tar.gz', '.env']) assert.equal(classifyFile(f), 'raw', f);
});

test('collision suffix only when two files map to the same public ID within one resource type', () => {
  const root = makeTree({ 'photo.jpg': 1, 'photo.png': 1, 'clip.png': 1, 'clip.mp4': 1, 'logo.svg': 1, 'data.json': 1, 'data.txt': 1 });
  const plan = planUpload({ cwd: 'site', localPath: root });
  const items = byRel(plan);
  assert.equal(items['photo.jpg'].publicId, 'site/photo_jpg');
  assert.equal(items['photo.png'].publicId, 'site/photo_png');
  assert.equal(items['photo.jpg'].hasCollision, true);
  // image "clip" and video "clip" don't collide: public IDs are unique per resource type.
  assert.equal(items['clip.png'].publicId, 'site/clip');
  assert.equal(items['clip.mp4'].publicId, 'site/clip');
  assert.equal(items['clip.mp4'].hasCollision, false);
  assert.equal(items['logo.svg'].publicId, 'site/logo');
  // raw files keep their extension, so they never collide with each other.
  assert.equal(items['data.json'].publicId, 'site/data.json');
  assert.equal(items['data.txt'].publicId, 'site/data.txt');
});

test('directories: subfolders mirrored with -r, skipped (and counted) without it; dotfiles skipped', () => {
  const root = makeTree({ 'hero.png': 1, '.env': 'SECRET=1', '.git/config': 1, 'sub/nested/a.png': 1, 'sub/b.txt': 1 });
  const flat = planUpload({ cwd: 'apps', localPath: root });
  assert.deepEqual(flat.items.map(i => i.publicId), ['apps/hero']);
  assert.equal(flat.skippedDirectories, 1);

  const deep = planUpload({ cwd: 'apps', localPath: root, recursive: true, folder: 'app1' });
  assert.deepEqual(deep.items.map(i => [i.publicId, i.folder, i.resourceType]).sort(), [
    ['apps/app1/hero', 'apps/app1', 'image'],
    ['apps/app1/sub/b.txt', 'apps/app1/sub', 'raw'],
    ['apps/app1/sub/nested/a', 'apps/app1/sub/nested', 'image'],
  ]);
  assert.equal(deep.isDirectory, true);
  assert.equal(deep.total, 3);
});

test('target folder resolves like every remote path: relative to cwd, "/" = root, ".." = parent', () => {
  const root = makeTree({ 'a.png': 1 });
  const file = path.join(root, 'a.png');
  assert.equal(planUpload({ cwd: 'x/y', localPath: file }).items[0].publicId, 'x/y/a');
  assert.equal(planUpload({ cwd: 'x/y', localPath: file, folder: '/' }).items[0].publicId, 'a');
  assert.equal(planUpload({ cwd: 'x/y', localPath: file, folder: '../z' }).items[0].publicId, 'x/z/a');
});

test('single file: custom name (may include a path); raw names get their extension', () => {
  const root = makeTree({ 'a.png': 1, 'notes.txt': 'hi' });
  const img = planUpload({ cwd: 'x', localPath: path.join(root, 'a.png'), name: 'sub/cover' }).items[0];
  assert.deepEqual([img.folder, img.name, img.publicId], ['x/sub', 'cover', 'x/sub/cover']);
  const raw = planUpload({ cwd: 'x', localPath: path.join(root, 'notes.txt'), name: 'readme' }).items[0];
  assert.equal(raw.publicId, 'x/readme.txt');
  assert.equal(planUpload({ localPath: path.join(root, 'notes.txt'), name: 'readme.TXT' }).items[0].publicId, 'readme.TXT');
  assert.equal(raw.bytes, 2);
});

test('--rt overrides classification; raw override keeps the extension', () => {
  const root = makeTree({ 'a.png': 1, 'b.mp4': 1 });
  const plan = planUpload({ localPath: root, resourceType: 'raw' });
  assert.deepEqual(plan.items.map(i => [i.publicId, i.resourceType]), [['a.png', 'raw'], ['b.mp4', 'raw']]);
  const auto = planUpload({ localPath: root, resourceType: 'auto' });
  assert.deepEqual(auto.items.map(i => i.resourceType), ['image', 'video']);
  assert.throws(() => planUpload({ localPath: root, resourceType: 'audio' }), { code: CODES.USAGE });
});

test('errors: missing path, name with a directory, sandbox refusal', () => {
  const root = makeTree({ 'a.png': 1 });
  assert.throws(() => planUpload({ localPath: path.join(root, 'nope.png') }), { code: CODES.NOT_FOUND });
  assert.throws(() => planUpload({ localPath: root, name: 'x' }), { code: CODES.USAGE });
  assert.throws(() => planUpload({}), { code: CODES.USAGE });
  assert.throws(() => planUpload({ localPath: root, allowPath: () => false }), { code: CODES.FORBIDDEN });
  assert.equal(planUpload({ localPath: root, allowPath: (p) => p.startsWith(fs.realpathSync(root)) }).total, 1);
});
