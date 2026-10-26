import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadHistory, appendHistoryLine, pruneHistory, recordHistory } from '../lib/history.js';
import { tempDir } from './helpers/cli.js';

const posix = process.platform !== 'win32';
const histFile = () => path.join(tempDir('cldsh-hist-'), '.cldsh_history');

test('history: append, load newest first, prune', () => {
  const file = histFile();
  appendHistoryLine('help', file);
  appendHistoryLine('ls -l', file);
  appendHistoryLine('cd apps', file);
  assert.deepEqual(loadHistory(file), ['cd apps', 'ls -l', 'help']);
  pruneHistory(file, 2);
  assert.deepEqual(loadHistory(file), ['cd apps', 'ls -l']);
});

test('history: a new file is created with mode 0600', { skip: !posix }, () => {
  const file = histFile();
  appendHistoryLine('pwd', file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('history: credential lines are kept out of the file and readline memory', () => {
  const file = histFile();
  // readline has already added the line to rl.history when it emits 'line'.
  const rl = { history: [] };
  for (const line of ['ls', 'login prod cloudinary://k:s@c', 'login', 'echo cloudinary://k:s@c', 'pwd', 'logins-are-fine']) {
    rl.history.unshift(line);
    recordHistory(rl, line, file);
  }
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /cloudinary:\/\//);
  assert.doesNotMatch(text, /^login(\s|$)/m);
  assert.deepEqual(loadHistory(file), ['logins-are-fine', 'pwd', 'ls']);
  assert.deepEqual(rl.history, ['logins-are-fine', 'pwd', 'ls']);
});

test('history: an existing file is tightened to 0600 and scrubbed on load', () => {
  const file = histFile();
  fs.writeFileSync(file, 'ls\nlogin default cloudinary://k:s@c\nconfig\n', { mode: 0o644 });
  if (posix) fs.chmodSync(file, 0o644);
  assert.deepEqual(loadHistory(file), ['config', 'ls']);
  assert.equal(fs.readFileSync(file, 'utf8'), 'ls\nconfig\n');
  if (posix) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
