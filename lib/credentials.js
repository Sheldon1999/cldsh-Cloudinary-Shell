// Saved Cloudinary accounts (profiles) in ~/.config/cldsh/credentials.json, and CLOUDINARY_URL parsing.
//
// Store format (version 2):
//   { "version": 2, "current_profile": "prod" | null,
//     "profiles": { "prod": { "cloud_name", "api_key", "api_secret", "options"? } } }
// Version 1 (no `version` field, `current_profile` defaulting to "default") is migrated on load.
//
// The file holds secrets, so it is written atomically (temp file in the same directory with
// mode 0600, fsync, rename) and a file we cannot read is never overwritten.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { CldshError, CODES, notFound } from './errors.js';

export const STORE_VERSION = 2;

export function getConfigDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'cldsh');
  }
  return path.join(os.homedir(), '.config', 'cldsh');
}

export function getCredentialsPath() {
  return path.join(getConfigDir(), 'credentials.json');
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse a CLOUDINARY_URL (`cloudinary://<api_key>:<api_secret>@<cloud_name>[/<secure_distribution>][?<option>=<value>...]`).
 * Accepts the forms people paste: `export CLOUDINARY_URL=...`, `CLOUDINARY_URL=...`, quoted values.
 * Mirrors the SDK's own parser: a path means a private CDN (`secure_distribution`), query parameters
 * (`upload_prefix`, `cname`, ...) become config options.
 * @returns {{ cloud_name: string, api_key: string, api_secret: string, options: object } | null}
 */
export function parseCloudinaryUrl(input = '') {
  let s = String(input ?? '').trim();
  if (s.startsWith('export ')) s = s.slice('export '.length).trim();
  if (s.startsWith('CLOUDINARY_URL=')) s = s.slice('CLOUDINARY_URL='.length).trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  if (!/^cloudinary:\/\//i.test(s)) return null;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const cloud_name = decode(url.hostname);
  const api_key = decode(url.username);
  const api_secret = decode(url.password);
  if (!cloud_name || !api_key || !api_secret) return null;

  const options = {};
  if (url.pathname && url.pathname !== '/') {
    options.private_cdn = true;
    options.secure_distribution = decode(url.pathname.slice(1));
  }
  for (const [key, value] of url.searchParams) {
    options[key] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return { cloud_name, api_key, api_secret, options };
}

export function maskSecret(secret = '') {
  if (!secret) return '';
  if (secret.length <= 4) return '****';
  return '*'.repeat(Math.max(8, secret.length - 4)) + secret.slice(-4);
}

function tightenPermissions(filePath, isDir = false) {
  if (process.platform === 'win32') return;
  try {
    const current = fs.statSync(filePath).mode & 0o777;
    if ((current & 0o077) !== 0) fs.chmodSync(filePath, isDir ? 0o700 : 0o600);
  } catch {}
}

const emptyStore = () => ({ version: STORE_VERSION, current_profile: null, profiles: {} });

function unreadable(filePath, why) {
  return new CldshError(CODES.LOCAL, `Cannot read the credentials file ${filePath}: ${why}`, {
    hint: `Fix the file, or run "cldsh login --reset" to move it to ${path.basename(filePath)}.bak and start a new one.`,
  });
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Load the store, migrating version 1 in memory.
 * Throws CldshError(LOCAL) naming the file when it exists but cannot be used (so it is never overwritten).
 */
export function loadCredentialsStore(filePath = getCredentialsPath()) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return emptyStore();
    throw unreadable(filePath, e.message);
  }
  tightenPermissions(filePath);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadable(filePath, 'it is not valid JSON');
  }
  if (!isPlainObject(parsed)) throw unreadable(filePath, 'it does not contain a JSON object');
  const version = parsed.version ?? 1;
  if (version !== 1 && version !== STORE_VERSION) {
    throw unreadable(filePath, `unknown store version ${JSON.stringify(parsed.version)} (written by a newer cldsh?)`);
  }
  const profilesIn = parsed.profiles ?? {};
  if (!isPlainObject(profilesIn)) throw unreadable(filePath, '"profiles" is not an object');

  const profiles = {};
  for (const [name, p] of Object.entries(profilesIn)) {
    if (!isPlainObject(p)) throw unreadable(filePath, `profile "${name}" is not an object`);
    profiles[name] = {
      cloud_name: String(p.cloud_name ?? ''),
      api_key: String(p.api_key ?? ''),
      api_secret: String(p.api_secret ?? ''),
      ...(isPlainObject(p.options) && Object.keys(p.options).length ? { options: { ...p.options } } : {}),
    };
  }
  // Version 1 defaulted current_profile to "default" even when no such profile existed.
  const current = typeof parsed.current_profile === 'string' && Object.hasOwn(profiles, parsed.current_profile)
    ? parsed.current_profile
    : null;
  return { version: STORE_VERSION, current_profile: current, profiles };
}

/** Write the store atomically: temp file (0600) in the same directory, fsync, rename. */
export function saveCredentialsStore(store, filePath = getCredentialsPath()) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  tightenPermissions(dir, true);

  const data = JSON.stringify({
    version: STORE_VERSION,
    current_profile: store.current_profile ?? null,
    profiles: store.profiles ?? {},
  }, null, 2) + '\n';

  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, data, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new CldshError(CODES.LOCAL, `Could not save the credentials file ${filePath}: ${e.message}`, { cause: e });
  }
  // Make the rename durable (best effort; not supported for directories on every platform).
  try {
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch {}
}

/**
 * Move the credentials file aside (`<file>.bak`, or `<file>.bak.N` if that exists).
 * @returns {string | null} the backup path, or null when there was no file
 */
export function backupCredentialsStore(filePath = getCredentialsPath()) {
  if (!fs.existsSync(filePath)) return null;
  let target = `${filePath}.bak`;
  for (let n = 1; fs.existsSync(target); n++) target = `${filePath}.bak.${n}`;
  fs.renameSync(filePath, target);
  return target;
}

export function getProfile(name, store = loadCredentialsStore()) {
  const target = name || store.current_profile;
  if (!target || !Object.hasOwn(store.profiles ?? {}, target)) return null;
  return store.profiles[target];
}

export function saveProfile(name = 'default', creds = {}, setAsCurrent = true, filePath = getCredentialsPath()) {
  const store = loadCredentialsStore(filePath);
  const options = creds.options && Object.keys(creds.options).length ? { ...creds.options } : null;
  store.profiles[name] = {
    cloud_name: creds.cloud_name || '',
    api_key: creds.api_key || '',
    api_secret: creds.api_secret || '',
    ...(options ? { options } : {}),
  };
  if (setAsCurrent || !store.current_profile) store.current_profile = name;
  saveCredentialsStore(store, filePath);
  return store;
}

/**
 * Delete a profile. Removing the saved default clears `current_profile` (no silent switch to another account).
 * @returns {boolean} whether the profile existed
 */
export function removeProfile(name, filePath = getCredentialsPath()) {
  const store = loadCredentialsStore(filePath);
  if (!Object.hasOwn(store.profiles, name)) return false;
  delete store.profiles[name];
  if (store.current_profile === name) store.current_profile = null;
  saveCredentialsStore(store, filePath);
  return true;
}

export function setCurrentProfile(name, filePath = getCredentialsPath()) {
  const store = loadCredentialsStore(filePath);
  if (!Object.hasOwn(store.profiles, name)) {
    throw notFound(`Profile "${name}" does not exist`, 'run "config ls" to see saved profiles');
  }
  store.current_profile = name;
  saveCredentialsStore(store, filePath);
  return store;
}
