import test from 'node:test';
import assert from 'node:assert/strict';
import { isGlob, globToRegex, matchGlob, parseGlobTarget } from '../lib/glob.js';

test('glob: isGlob detects wildcards', () => {
  assert.equal(isGlob('cld*'), true);
  assert.equal(isGlob('*.png'), true);
  assert.equal(isGlob('image?.jpg'), true);
  assert.equal(isGlob('regular-file'), false);
  assert.equal(isGlob('apps/subfolder'), false);
  assert.equal(isGlob(''), false);
});

test('glob: globToRegex matches filenames properly', () => {
  const regPrefix = globToRegex('cld*');
  assert.equal(regPrefix.test('cld'), true);
  assert.equal(regPrefix.test('cld-screen-1'), true);
  assert.equal(regPrefix.test('cld_banner'), true);
  assert.equal(regPrefix.test('other-cld'), false);

  const regExt = globToRegex('*.png');
  assert.equal(regExt.test('logo.png'), true);
  assert.equal(regExt.test('photo.jpg'), false);
  assert.equal(regExt.test('png'), false);

  const regQuestion = globToRegex('image-?');
  assert.equal(regQuestion.test('image-1'), true);
  assert.equal(regQuestion.test('image-a'), true);
  assert.equal(regQuestion.test('image-12'), false);
});

test('glob: parseGlobTarget parses directory and pattern components', () => {
  const simple = parseGlobTarget('', 'cld*');
  assert.equal(simple.folderPart, '');
  assert.equal(simple.filePattern, 'cld*');
  assert.ok(simple.regex.test('cld-hero'));

  const nested = parseGlobTarget('apps', 'screenshots/cld*');
  assert.equal(nested.folderPart, 'screenshots');
  assert.equal(nested.filePattern, 'cld*');

  const nonGlob = parseGlobTarget('', 'regular-file');
  assert.equal(nonGlob, null);
});
