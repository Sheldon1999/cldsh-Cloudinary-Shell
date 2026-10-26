import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

test('tests run with an isolated HOME (never the developer\'s real config)', () => {
  assert.match(os.homedir(), /cldsh-test-home-/);
  assert.equal(process.env.CLOUDINARY_URL, undefined);
});
