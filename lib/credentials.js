import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export function getConfigDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'cldsh');
  }
  const home = os.homedir();
  return path.join(home, '.config', 'cldsh');
}

export function getCredentialsPath() {
  return path.join(getConfigDir(), 'credentials.json');
}

export function parseCloudinaryUrl(urlStr = '') {
  let trimmed = (urlStr || '').trim();
  if (trimmed.startsWith('export ')) {
    trimmed = trimmed.slice(7).trim();
  }
  if (trimmed.startsWith('CLOUDINARY_URL=')) {
    trimmed = trimmed.slice('CLOUDINARY_URL='.length).trim();
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  const m = trimmed.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/i);
  if (m) {
    return {
      api_key: m[1],
      api_secret: m[2],
      cloud_name: m[3],
    };
  }
  return null;
}

export function maskSecret(secret = '') {
  if (!secret) return '';
  if (secret.length <= 4) return '****';
  return '*'.repeat(Math.max(8, secret.length - 4)) + secret.slice(-4);
}

function ensureSecurePermissions(filePath, isDir = false) {
  if (process.platform === 'win32') return;
  try {
    const stat = fs.statSync(filePath);
    const expected = isDir ? 0o700 : 0o600;
    const current = stat.mode & 0o777;
    // If permissions are more permissive than expected, tighten them
    if ((current & (isDir ? 0o077 : 0o177)) !== 0) {
      fs.chmodSync(filePath, expected);
    }
  } catch {}
}

export function loadCredentialsStore(filePath = getCredentialsPath()) {
  const empty = { current_profile: 'default', profiles: {} };
  if (!fs.existsSync(filePath)) return empty;

  ensureSecurePermissions(filePath, false);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    return {
      current_profile: parsed.current_profile || 'default',
      profiles: parsed.profiles || {},
    };
  } catch {
    return empty;
  }
}

export function saveCredentialsStore(store, filePath = getCredentialsPath()) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  ensureSecurePermissions(dir, true);

  const jsonStr = JSON.stringify(store, null, 2) + '\n';
  fs.writeFileSync(filePath, jsonStr, { mode: 0o600, encoding: 'utf8' });
  ensureSecurePermissions(filePath, false);
}

export function getProfile(name, store = loadCredentialsStore()) {
  const target = name || store.current_profile || 'default';
  return store.profiles?.[target] || null;
}

export function saveProfile(name = 'default', creds = {}, setAsCurrent = true, filePath = getCredentialsPath()) {
  const store = loadCredentialsStore(filePath);
  store.profiles[name] = {
    cloud_name: creds.cloud_name || '',
    api_key: creds.api_key || '',
    api_secret: creds.api_secret || '',
  };
  if (setAsCurrent || !store.current_profile) {
    store.current_profile = name;
  }
  saveCredentialsStore(store, filePath);
  return store;
}

export function removeProfile(name, filePath = getCredentialsPath()) {
  const store = loadCredentialsStore(filePath);
  if (store.profiles[name]) {
    delete store.profiles[name];
    if (store.current_profile === name) {
      const remaining = Object.keys(store.profiles);
      store.current_profile = remaining[0] || 'default';
    }
    saveCredentialsStore(store, filePath);
    return true;
  }
  return false;
}

export function setCurrentProfile(name, filePath = getCredentialsPath()) {
  const store = loadCredentialsStore(filePath);
  if (!store.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist.`);
  }
  store.current_profile = name;
  saveCredentialsStore(store, filePath);
  return store;
}
