// Shell history (~/.cldsh_history, mode 0600). Lines that may carry credentials
// (`login ...`, anything containing `cloudinary://`) are never stored, on disk or in memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const MAX_HISTORY_LINES = 1000;

export function getHistoryFilePath() {
  const home = os.homedir();
  if (home) return path.join(home, '.cldsh_history');
  return path.resolve(process.cwd(), '.cldsh_history');
}

/** Could this shell line contain credentials? */
export function isSecretLine(line = '') {
  return /cloudinary:\/\//i.test(line) || /^\s*login(\s|$)/.test(line);
}

function tighten(filePath) {
  if (process.platform === 'win32') return;
  try {
    if ((fs.statSync(filePath).mode & 0o077) !== 0) fs.chmodSync(filePath, 0o600);
  } catch {}
}

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function writeLines(filePath, lines) {
  fs.writeFileSync(filePath, lines.length ? lines.join('\n') + '\n' : '', { encoding: 'utf8', mode: 0o600 });
  tighten(filePath);
}

/**
 * Load the history for readline (newest first). Tightens the file to 0600 and removes
 * credential-bearing lines that older versions stored.
 */
export function loadHistory(filePath = getHistoryFilePath()) {
  try {
    if (!fs.existsSync(filePath)) return [];
    tighten(filePath);
    const all = readLines(filePath);
    const lines = all.filter(l => !isSecretLine(l));
    if (lines.length !== all.length) writeLines(filePath, lines);
    return lines.slice(-MAX_HISTORY_LINES).reverse();
  } catch {
    return [];
  }
}

export function appendHistoryLine(line = '', filePath = getHistoryFilePath()) {
  const trimmed = line.trim();
  if (!trimmed || isSecretLine(trimmed)) return;
  try {
    fs.appendFileSync(filePath, trimmed + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

export function pruneHistory(filePath = getHistoryFilePath(), maxLines = MAX_HISTORY_LINES) {
  try {
    if (!fs.existsSync(filePath)) return;
    const all = readLines(filePath);
    const lines = all.filter(l => !isSecretLine(l));
    if (lines.length > maxLines || lines.length !== all.length) writeLines(filePath, lines.slice(-maxLines));
  } catch {}
}

/**
 * Record a shell line: append it to the history file, or, for a credential-bearing line, drop it
 * from readline's in-memory history too (readline adds the line before emitting 'line').
 */
export function recordHistory(rl, line, filePath = getHistoryFilePath()) {
  if (isSecretLine(line)) {
    const h = rl?.history;
    if (Array.isArray(h)) {
      for (let i = h.length - 1; i >= 0; i--) if (isSecretLine(h[i])) h.splice(i, 1);
    }
    return;
  }
  appendHistoryLine(line, filePath);
}
