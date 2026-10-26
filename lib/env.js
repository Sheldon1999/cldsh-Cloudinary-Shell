// Which Cloudinary account is active, and why.
//
// Sources, strongest first:
//   1. an explicit profile: `--profile` (loadEnvAndConfig({ profileName })), a profile chosen in this
//      session (`config use` / `login`, see setSessionProfile), or CLOUDINARY_PROFILE;
//   2. CLOUDINARY_URL, then CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET in the environment;
//   3. ./.env (CLOUDINARY_URL, then the three variables);
//   4. the saved default profile (`current_profile` in the credentials store).
// Weaker sources that are also present are reported as `shadowed`, so the user can see that
// e.g. a project's .env overrides the saved default.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { configureSdk } from './sdk.js';
import { notFound } from './errors.js';
import { loadCredentialsStore, getCredentialsPath, parseCloudinaryUrl } from './credentials.js';

let activeConfig = null;
let sessionProfile = null;
const listeners = new Set();

/** Subscribe to credential changes (e.g. the storage backend resets its cache). Returns an unsubscribe function. */
export function onCredentialsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Remember the profile chosen in this session (`config use`, `login`); `null` forgets it. */
export function setSessionProfile(name) {
  sessionProfile = name || null;
}

export function getSessionProfile() {
  return sessionProfile;
}

function parseEnvFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  const res = {};
  for (const l of text.split(/\r?\n/)) {
    const trimmed = l.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    res[m[1]] = val;
  }
  return res;
}

const complete = (c) => Boolean(c && c.cloud_name && c.api_key && c.api_secret);

function fromProfile(store, name, source) {
  const p = store && Object.hasOwn(store.profiles, name) ? store.profiles[name] : null;
  if (!complete(p)) return null;
  return {
    cloud_name: p.cloud_name,
    api_key: p.api_key,
    api_secret: p.api_secret,
    options: { ...(p.options || {}) },
    source,
    profile: name,
    kind: 'profile',
  };
}

/** Candidates from a set of variables (process environment or a .env file), URL first. */
function fromVariables(vars, { kind, profile, urlSource, trioSource }, warnings) {
  const out = [];
  if (vars.CLOUDINARY_URL) {
    const parsed = parseCloudinaryUrl(vars.CLOUDINARY_URL);
    if (parsed) out.push({ ...parsed, source: urlSource, profile, kind });
    else warnings.push(`${urlSource} is set but is not a valid cloudinary:// URL; ignored.`);
  }
  if (vars.CLOUDINARY_CLOUD_NAME && vars.CLOUDINARY_API_KEY && vars.CLOUDINARY_API_SECRET) {
    out.push({
      cloud_name: vars.CLOUDINARY_CLOUD_NAME,
      api_key: vars.CLOUDINARY_API_KEY,
      api_secret: vars.CLOUDINARY_API_SECRET,
      options: {},
      source: trioSource,
      profile,
      kind,
    });
  }
  return out;
}

const describe = (c) => `${c.source} (cloud ${c.cloud_name})`;

/**
 * Evaluate every credential source.
 * @param {object} [opts]
 * @param {string|null} [opts.profileName] explicit profile (--profile); missing → NOT_FOUND error
 * @param {boolean} [opts.ignoreSession] resolve as a fresh start would (no session choice)
 * @param {object} [opts.env] environment (default process.env)
 * @param {string} [opts.cwd] directory whose .env is read (default process.cwd())
 * @param {string} [opts.storePath] credentials file (default ~/.config/cldsh/credentials.json)
 * @returns {{ winner: object|null, shadowed: object[], warnings: string[], problems: string[] }}
 *   `warnings` = `problems` (unusable sources, unreadable store) plus "X is overridden by Y" notes
 */
export function resolveSources({
  profileName = null,
  ignoreSession = false,
  env = process.env,
  cwd = process.cwd(),
  storePath = getCredentialsPath(),
} = {}) {
  const warnings = [];
  let store = null;
  let storeError = null;
  try {
    store = loadCredentialsStore(storePath);
  } catch (e) {
    storeError = e;
  }

  const candidates = [];
  let blocked = false;

  // 1. Explicit profile choice.
  const explicit = profileName
    ? { name: profileName, source: `profile "${profileName}" (--profile)` }
    : !ignoreSession && sessionProfile
      ? { name: sessionProfile, source: `profile "${sessionProfile}" (chosen in this session)` }
      : env.CLOUDINARY_PROFILE
        ? { name: env.CLOUDINARY_PROFILE, source: `profile "${env.CLOUDINARY_PROFILE}" (CLOUDINARY_PROFILE)` }
        : null;
  if (explicit) {
    if (storeError && profileName) throw storeError;
    const c = storeError ? null : fromProfile(store, explicit.name, explicit.source);
    if (c) {
      candidates.push(c);
    } else if (profileName) {
      throw notFound(`Profile "${profileName}" is not saved (or is incomplete) in ${storePath}`, 'run "cldsh config ls" to see saved profiles');
    } else {
      // An explicit choice that cannot be honored must not silently fall back to another account.
      blocked = true;
      warnings.push(storeError
        ? `${explicit.source} cannot be used: ${storeError.message}. Not connected.`
        : `${explicit.source} is not saved (or is incomplete) in ${storePath}. Not connected; run "login ${explicit.name}".`);
    }
  }

  // 2. Environment variables.
  candidates.push(...fromVariables(env, {
    kind: 'env',
    profile: 'env',
    urlSource: 'CLOUDINARY_URL environment variable',
    trioSource: 'CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET environment variables',
  }, warnings));

  // 3. ./.env
  candidates.push(...fromVariables(parseEnvFile(path.resolve(cwd, '.env')), {
    kind: 'dotenv',
    profile: 'local',
    urlSource: '.env file (CLOUDINARY_URL)',
    trioSource: '.env file (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)',
  }, warnings));

  // 4. Saved default profile.
  if (storeError) {
    if (!blocked) warnings.push(`${storeError.message}. Saved profiles are ignored.`);
  } else if (store.current_profile && store.current_profile !== explicit?.name) {
    const c = fromProfile(store, store.current_profile, `saved default profile "${store.current_profile}"`);
    if (c) candidates.push(c);
  }

  const winner = blocked ? null : candidates[0] ?? null;
  const shadowed = (blocked ? candidates : candidates.slice(1)).map(c => ({ source: c.source, profile: c.profile, cloud_name: c.cloud_name }));
  const problems = [...warnings];
  if (winner) {
    for (const c of candidates.slice(1)) {
      if (c.cloud_name !== winner.cloud_name || c.api_key !== winner.api_key) {
        warnings.push(`${describe(c)} is overridden by ${describe(winner)}.`);
      }
    }
  }
  return { winner, shadowed, warnings, problems };
}

/** The credentials that would be used (with `source` and `profile`), or null. */
export function resolveCredentials(opts = {}) {
  return resolveSources(opts).winner;
}

/** Make `creds` the active account (null disconnects) and configure the SDK with exactly these values. */
export function applyCredentials(creds) {
  activeConfig = creds || null;
  configureSdk(activeConfig);
  for (const fn of listeners) fn(activeConfig);
  return Boolean(activeConfig);
}

/** `{ cloud_name, api_key, api_secret, options, source, profile, kind, shadowed }` of the active account, or null. */
export function getActiveConfig() {
  return activeConfig;
}

export function isConfigured() {
  return complete(activeConfig);
}

/**
 * Resolve the sources (see resolveSources for options) and apply the winner (or disconnect).
 * A corrupt credentials store becomes a warning; only an explicit `profileName` that cannot be used throws.
 */
export function loadEnvAndConfig(opts = {}) {
  const { winner, shadowed, warnings } = resolveSources(opts);
  applyCredentials(winner ? { ...winner, shadowed } : null);
  return {
    configured: Boolean(winner),
    source: winner?.source ?? null,
    cloud_name: winner?.cloud_name ?? null,
    profile: winner?.profile ?? null,
    shadowed,
    warnings,
  };
}

/**
 * What a fresh start would pick if the session choice were gone, when that differs from `profileName`
 * (e.g. CLOUDINARY_URL or a .env overrides the saved default). Never throws.
 * @returns {{ source: string, cloud_name: string } | null}
 */
export function strongerSourceAtNextStart(profileName, opts = {}) {
  try {
    const { winner } = resolveSources({ ...opts, ignoreSession: true });
    if (winner && !(winner.kind === 'profile' && winner.profile === profileName)) {
      return { source: winner.source, cloud_name: winner.cloud_name };
    }
  } catch {}
  return null;
}
