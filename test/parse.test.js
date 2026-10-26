import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parseArgs } from '../lib/parse.js';
import { CldshError } from '../lib/errors.js';

const rm = {
  name: 'rm',
  flags: {
    recursive: { type: 'boolean', short: 'r' },
    force: { type: 'boolean', short: 'f' },
    rt: { type: 'string', alias: ['resource-type'], values: ['all', 'image', 'video', 'raw'] },
    'dry-run': { type: 'boolean' },
  },
};
const tree = { name: 'tree', flags: { depth: { type: 'number', short: 'd' }, max: { type: 'number' } } };

test('tokenize: quotes group words and are removed, also inside a token', () => {
  assert.deepEqual(tokenize('upload "my pictures/hero image.png" \'hero banner\''), ['upload', 'my pictures/hero image.png', 'hero banner']);
  assert.deepEqual(tokenize('url logo --t="f_auto,q_auto"'), ['url', 'logo', '--t=f_auto,q_auto']);
  assert.deepEqual(tokenize('rm a\\ b'), ['rm', 'a b']);
  assert.deepEqual(tokenize('   '), []);
});

test('tokenize: unterminated quote is a usage error', () => {
  assert.throws(() => tokenize('ls "apps'), (e) => e instanceof CldshError && e.exitCode === 2);
});

test('parseArgs: a boolean short flag never swallows the next positional', () => {
  assert.deepEqual(parseArgs(['-r', 'folder'], rm), { args: ['folder'], flags: { recursive: true } });
  assert.deepEqual(parseArgs(['--dry-run', 'cld*'], rm), { args: ['cld*'], flags: { 'dry-run': true } });
});

test('parseArgs: clusters, value flags and aliases', () => {
  assert.deepEqual(parseArgs(['-rf', 'apps/old'], rm).flags, { recursive: true, force: true });
  assert.equal(parseArgs(['-d', '2'], tree).flags.depth, 2);
  assert.equal(parseArgs(['-d2'], tree).flags.depth, 2);
  assert.equal(parseArgs(['--max=50'], tree).flags.max, 50);
  assert.equal(parseArgs(['--resource-type', 'video', 'x'], rm).flags.rt, 'video');
});

test('parseArgs: --no-<flag> negates, -- ends options', () => {
  assert.equal(parseArgs(['--no-recursive'], rm).flags.recursive, false);
  assert.deepEqual(parseArgs(['--', '-weird-name'], rm).args, ['-weird-name']);
});

test('parseArgs: invalid input is a usage error with a hint', () => {
  const usage = (fn) => assert.throws(fn, (e) => e instanceof CldshError && e.exitCode === 2);
  usage(() => parseArgs(['--recursiv'], rm));
  usage(() => parseArgs(['-x'], rm));
  usage(() => parseArgs(['--rt=gif'], rm));
  usage(() => parseArgs(['-d', 'two'], tree));
  usage(() => parseArgs(['--max'], tree));
  try { parseArgs(['--recursiv'], rm); } catch (e) { assert.match(e.hint, /--recursive/); }
});

test('parseArgs: global flags are accepted by every command', () => {
  const { flags } = parseArgs(['--json', '--profile', 'prod', '-h'], tree);
  assert.deepEqual(flags, { json: true, profile: 'prod', help: true });
});
