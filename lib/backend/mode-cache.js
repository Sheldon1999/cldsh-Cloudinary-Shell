// Remembers each cloud's folder mode for a day, so single commands (one process each) don't spend
// an Admin API request on detection every time. Folder mode only ever changes when Cloudinary
// migrates an environment from fixed to dynamic, which is rare; the TTL bounds that window.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { getConfigDir } from '../credentials.js';

const TTL_MS = 24 * 3600 * 1000;

const cachePath = () => path.join(getConfigDir(), 'folder-modes.json');

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function getCachedMode(cloudName, now = Date.now()) {
  const entry = read()[cloudName];
  if (!entry || (entry.mode !== 'fixed' && entry.mode !== 'dynamic')) return null;
  return now - Number(entry.checked_at) < TTL_MS ? entry.mode : null;
}

export function setCachedMode(cloudName, mode, now = Date.now()) {
  try {
    const data = read();
    data[cloudName] = { mode, checked_at: now };
    fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
    const file = cachePath();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // A cache that can't be written only costs one extra API request next time.
  }
}
