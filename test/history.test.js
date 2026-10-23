import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadHistory, appendHistoryLine, pruneHistory } from '../lib/history.js';

test('history: append, load, and prune', () => {
  const tmpFile = path.join(os.tmpdir(), `cldsh_test_history_${Date.now()}.txt`);

  try {
    appendHistoryLine('help', tmpFile);
    appendHistoryLine('ls -l', tmpFile);
    appendHistoryLine('cd apps', tmpFile);

    const history = loadHistory(tmpFile);
    // newest first
    assert.deepEqual(history, ['cd apps', 'ls -l', 'help']);

    // Prune test: cap at 2 items
    pruneHistory(tmpFile, 2);
    const prunedHistory = loadHistory(tmpFile);
    assert.deepEqual(prunedHistory, ['cd apps', 'ls -l']);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
});
