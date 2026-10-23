import test from 'node:test';
import assert from 'node:assert/strict';
import { renderItermImage, isTerminalGraphicsSupported } from '../commands/view.js';

test('view: renderItermImage generates compliant OSC 1337 sequence', () => {
  const dummyBuf = Buffer.from('test-image-data');
  const rendered = renderItermImage(dummyBuf, { width: 'auto' });

  assert.ok(rendered.startsWith('\u001B]1337;File=inline=1'));
  assert.ok(rendered.includes(dummyBuf.toString('base64')));
  assert.ok(rendered.endsWith('\u0007\n'));
});

test('view: isTerminalGraphicsSupported evaluates environment', () => {
  const res = isTerminalGraphicsSupported();
  assert.equal(typeof res, 'boolean');
});
