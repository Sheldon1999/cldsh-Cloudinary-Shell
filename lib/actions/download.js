// Download assets to the local disk.
//
// `planDownload` resolves the targets (names, paths, public IDs, `asset_id:<id>` or wildcards),
// builds a delivery URL per asset (signed for `authenticated`, `private_download_url` for
// `private`) and the local file name. `executeDownload` fetches with bounded concurrency, never
// overwrites an existing file unless asked, and only writes inside the destination directory.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isGlob } from '../glob.js';
import { resolveLocal, baseName } from '../paths.js';
import { RESOURCE_TYPES, DELIVERY_TYPES } from '../backend/index.js';
import { CldshError, CODES, toCldError, usageError } from '../errors.js';
import { runPool, clampConcurrency, DEFAULT_CONCURRENCY } from './upload.js';

/**
 * Local file name for an asset: the last public ID segment plus `.format` when missing, with path
 * separators and control characters replaced and leading dots made visible (no `..`, no dotfiles
 * such as `.env` dropped into the working directory).
 */
export function localFileName(ref) {
  let name = baseName(ref.public_id);
  const format = ref.format ? String(ref.format) : '';
  if (format && !name.toLowerCase().endsWith(`.${format.toLowerCase()}`)) name += `.${format}`;
  name = name.replace(/[/\\\x00-\x1f\x7f]/g, '_');
  if (process.platform === 'win32') name = name.replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/, '');
  name = name.replace(/^\.+/, m => '_'.repeat(m.length));
  return name || 'download';
}

/** Delivery URL for downloading the original file. */
export function downloadUrl(sdk, ref) {
  const opts = { resource_type: ref.resource_type, secure: true, ...(ref.version ? { version: ref.version } : {}), ...(ref.format ? { format: ref.format } : {}) };
  if (ref.type === 'private') {
    return sdk.utils.private_download_url(ref.public_id, ref.format || '', { resource_type: ref.resource_type, type: 'private' });
  }
  if (ref.type === 'authenticated') {
    return sdk.url(ref.public_id, { ...opts, type: 'authenticated', sign_url: true });
  }
  return ref.secure_url || sdk.url(ref.public_id, { ...opts, type: ref.type || 'upload' });
}

const lexists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Is `p` strictly inside directory `dir`? */
const inside = (p, dir) => {
  const rel = path.relative(dir, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Resolve the targets and decide where each file goes.
 * `destination` is a directory, or a file path when there is exactly one non-wildcard target and
 * the destination is neither an existing directory nor ends with a path separator.
 * Default destination: the local working directory.
 * @returns {Promise<{ destination: string, items: object[], missing: object[], total: number }>}
 */
export async function planDownload(backend, { cwd = '', targets, destination, resourceType, deliveryType } = {}) {
  const list = (Array.isArray(targets) ? targets : [targets]).map(t => String(t ?? '').trim()).filter(Boolean);
  if (!list.length) throw usageError('download needs an asset name, path or pattern');

  const rt = resourceType && resourceType !== 'all' ? resourceType : undefined;
  const resourceTypes = rt ? [rt] : RESOURCE_TYPES;
  const deliveryTypes = deliveryType ? [deliveryType] : (backend.mode === 'dynamic' ? DELIVERY_TYPES : ['upload']);

  const refs = [];
  const missing = [];
  for (const t of list) {
    try {
      if (isGlob(t)) {
        const { assets } = await backend.findByGlob(cwd, t, { resourceTypes, deliveryTypes });
        if (!assets.length) throw new CldshError(CODES.NOT_FOUND, `No assets match ${t}`);
        refs.push(...assets);
      } else {
        refs.push(await backend.resolveAsset(cwd, t, { resourceType: rt, deliveryType }));
      }
    } catch (e) {
      const err = toCldError(e);
      if (list.length === 1 || (err.code !== CODES.NOT_FOUND && err.code !== CODES.CONFLICT)) throw err;
      missing.push({ target: t, status: 'failed', error: err.message, error_code: err.code });
    }
  }

  const destRaw = destination ? String(destination) : '';
  const destAbs = resolveLocal(destRaw || '.');
  const single = list.length === 1 && !isGlob(list[0]);
  const file = single && destRaw && !/[\\/]$/.test(destRaw) && !isDir(destAbs) ? destAbs : null;
  const dir = file ? path.dirname(file) : destAbs;

  const seenAssets = new Set();
  const usedPaths = new Set();
  const items = [];
  for (const ref of refs) {
    const assetKey = `${ref.resource_type}/${ref.type}/${ref.public_id}`;
    if (seenAssets.has(assetKey)) continue;
    seenAssets.add(assetKey);
    const localPath = file ?? path.join(dir, localFileName(ref));
    const item = {
      public_id: ref.public_id,
      resource_type: ref.resource_type,
      type: ref.type,
      format: ref.format,
      url: downloadUrl(backend.sdk, ref),
      localPath,
      exists: lexists(localPath),
    };
    if (!inside(localPath, dir)) {
      Object.assign(item, { error: `Refusing to write outside ${dir}`, error_code: CODES.FORBIDDEN });
    } else if (usedPaths.has(localPath)) {
      Object.assign(item, { error: `Another asset in this download is also saved as ${path.basename(localPath)}`, error_code: CODES.CONFLICT });
    }
    usedPaths.add(localPath);
    items.push(item);
  }

  return { destination: dir, items, missing, total: items.length + missing.length };
}

async function fetchTo(url, dest, overwrite) {
  const res = await fetch(url);
  if (!res.ok) {
    const code = res.status === 404 ? CODES.NOT_FOUND : (res.status === 401 || res.status === 403) ? CODES.FORBIDDEN : CODES.API;
    throw new CldshError(code, `Download failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, { httpCode: res.status });
  }
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  // Write next to the target, then rename: a failed transfer never leaves a truncated file behind.
  const tmp = path.join(dir, `.${path.basename(dest)}.${crypto.randomBytes(4).toString('hex')}.part`);
  try {
    const out = fs.createWriteStream(tmp, { flags: 'wx' });
    if (res.body) await pipeline(Readable.fromWeb(res.body), out);
    else await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    if (!overwrite && lexists(dest)) return null;
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return fs.statSync(dest).size;
}

export function summarizeDownload(items) {
  const summary = { total: items.length, downloaded: 0, skipped: 0, failed: 0, bytes: 0 };
  for (const it of items) {
    summary[it.status]++;
    if (it.status === 'downloaded') summary.bytes += it.bytes || 0;
  }
  return summary;
}

/**
 * Download a plan from `planDownload`.
 * @param {object} [o]
 * @param {boolean} [o.overwrite=false] replace existing local files
 * @param {number} [o.concurrency=4] parallel downloads (1..10)
 * @param {(done: number, total: number, item: object) => void} [o.onProgress]
 * @param {(absPath: string) => boolean} [o.allowPath] sandbox check for each local path
 */
export async function executeDownload(plan, { overwrite = false, concurrency = DEFAULT_CONCURRENCY, onProgress, allowPath } = {}) {
  const total = plan.items.length;
  let done = 0;
  const items = await runPool(plan.items, clampConcurrency(concurrency), async (item) => {
    let result;
    if (item.error) {
      result = { ...item, status: 'failed' };
    } else if (allowPath && !allowPath(item.localPath)) {
      result = { ...item, status: 'failed', error: `Access to ${item.localPath} is not allowed`, error_code: CODES.FORBIDDEN };
    } else if (!overwrite && lexists(item.localPath)) {
      result = { ...item, status: 'skipped', reason: 'exists' };
    } else {
      try {
        const bytes = await fetchTo(item.url, item.localPath, overwrite);
        result = bytes === null ? { ...item, status: 'skipped', reason: 'exists' } : { ...item, status: 'downloaded', bytes };
      } catch (e) {
        const err = toCldError(e);
        result = { ...item, status: 'failed', error: err.message, error_code: err.code };
      }
    }
    onProgress?.(++done, total, result);
    return result;
  });
  const all = [...items, ...(plan.missing || [])];
  return { destination: plan.destination, items: all, summary: summarizeDownload(all) };
}
