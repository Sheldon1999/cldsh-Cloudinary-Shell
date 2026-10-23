import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_HISTORY_LINES = 1000;

export function getHistoryFilePath() {
  const home = os.homedir();
  if (home) {
    return path.join(home, '.cldsh_history');
  }
  return path.resolve(process.cwd(), '.cldsh_history');
}

export function loadHistory(filePath = getHistoryFilePath()) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    // Return newest first for readline.history
    return lines.slice(-MAX_HISTORY_LINES).reverse();
  } catch {
    return [];
  }
}

export function appendHistoryLine(line = '', filePath = getHistoryFilePath()) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    fs.appendFileSync(filePath, trimmed + '\n', 'utf8');
  } catch {}
}

export function pruneHistory(filePath = getHistoryFilePath(), maxLines = MAX_HISTORY_LINES) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > maxLines) {
      const trimmed = lines.slice(-maxLines).join('\n') + '\n';
      fs.writeFileSync(filePath, trimmed, 'utf8');
    }
  } catch {}
}
