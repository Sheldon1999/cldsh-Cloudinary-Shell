import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCompletions } from '../lib/completer.js';

const COMMANDS = ['help', 'ls', 'cd', 'mkdir', 'upload', 'rm', 'pwd', 'tree', 'url', 'info', 'open', 'download', 'exit', 'quit'];
const FOLDERS = ['apps', 'assets', 'backup', 'dev'];

test('completer: returns all commands on empty line', () => {
  const [hits, prefix] = matchCompletions('', COMMANDS, FOLDERS);
  assert.equal(hits.length, COMMANDS.length);
  assert.equal(prefix, '');
});

test('completer: completes command prefix', () => {
  const [hits, prefix] = matchCompletions('c', COMMANDS, FOLDERS);
  assert.deepEqual(hits, ['cd']);
  assert.equal(prefix, 'c');
});

test('completer: completes multiple matching commands', () => {
  const [hits, prefix] = matchCompletions('u', COMMANDS, FOLDERS);
  assert.deepEqual(hits, ['upload', 'url']);
  assert.equal(prefix, 'u');
});

test('completer: completes folders after cd command', () => {
  const [hits, prefix] = matchCompletions('cd a', COMMANDS, FOLDERS);
  assert.deepEqual(hits, ['apps', 'assets']);
  assert.equal(prefix, 'a');
});

test('completer: returns all folders when typing cd with trailing space', () => {
  const [hits, prefix] = matchCompletions('cd ', COMMANDS, FOLDERS);
  assert.deepEqual(hits, FOLDERS);
  assert.equal(prefix, '');
});

test('completer: completes flags for known commands', () => {
  const [hits, prefix] = matchCompletions('ls -', COMMANDS, FOLDERS);
  assert.ok(hits.includes('-l'));
  assert.ok(hits.includes('--rt=image'));
  assert.equal(prefix, '-');
});
