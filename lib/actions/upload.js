// Upload local files or directories.
//
// `planUpload` is offline (no credentials, no network): it decides each file's resource type,
// folder and public ID, so `upload --dry-run` works without an account. `executeUpload` sends the
// plan with bounded concurrency, retries transient failures and reports per-file statuses.
import fs from 'node:fs';
import path from 'node:path';
import { classifyFile, extensionOf } from '../filetypes.js';
import { resolveRemote, resolveLocal, parentOf, baseName, join } from '../paths.js';
import { CldshError, CODES, toCldError, usageError } from '../errors.js';

const RESOURCE_TYPES = ['image', 'video', 'raw'];

/** Files larger than this use chunked upload (`upload_large`), in chunks of this size. */
export const LARGE_FILE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 10;
const MAX_ATTEMPTS = 3;

/** Clamp a requested concurrency to 1..MAX_CONCURRENCY (default when absent or invalid). */
export function clampConcurrency(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, v);
}

/** Run `fn` over `items` with at most `concurrency` in flight; results keep the input order. */
export async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Regular files under `dir` (relative paths with `/`), sorted; dotfiles, dot-directories and symlinks are skipped. */
function collectFiles(dir, recursive) {
  const files = [];
  let skippedDirectories = 0;
  const walk = (abs, rel) => {
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (recursive) walk(childAbs, childRel);
        else skippedDirectories++;
      } else if (e.isFile()) {
        files.push({ filePath: childAbs, relPath: childRel });
      }
    }
  };
  walk(dir, '');
  return { files, skippedDirectories };
}

function statLocal(abs) {
  try {
    return fs.statSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      throw new CldshError(CODES.NOT_FOUND, `No such local file or directory: ${abs}`);
    }
    throw toCldError(e);
  }
}

/**
 * Plan an upload without touching the network.
 * @param {object} o
 * @param {string} [o.cwd] current remote folder
 * @param {string} o.localPath local file or directory
 * @param {string} [o.name] custom name for a single file (may contain a relative remote path)
 * @param {string} [o.folder] target remote folder, resolved against `cwd` (default: `cwd`)
 * @param {boolean} [o.recursive] include subdirectories (mirrored as subfolders)
 * @param {string} [o.resourceType] 'image' | 'video' | 'raw' forces the type; absent or 'auto' classifies per file
 * @param {(absPath: string) => boolean} [o.allowPath] sandbox check, called with each file's real path
 */
export function planUpload({ cwd = '', localPath, name, folder, recursive = false, resourceType, allowPath } = {}) {
  if (!localPath) throw usageError('upload needs a local file or directory');
  const forced = resourceType && resourceType !== 'auto' ? resourceType : null;
  if (forced && !RESOURCE_TYPES.includes(forced)) {
    throw usageError(`Unknown resource type "${resourceType}"`, 'use image, video, raw or auto');
  }
  const abs = resolveLocal(localPath);
  const stat = statLocal(abs);
  const target = resolveRemote(cwd, folder ?? '.');

  let files;
  let skippedDirectories = 0;
  const isDirectory = stat.isDirectory();
  if (isDirectory) {
    if (name) throw usageError('A name can only be given when uploading a single file');
    ({ files, skippedDirectories } = collectFiles(abs, recursive));
  } else if (stat.isFile()) {
    files = [{ filePath: abs, relPath: path.basename(abs) }];
  } else {
    throw usageError(`Not a regular file or directory: ${abs}`);
  }

  if (allowPath) {
    for (const f of files) {
      if (!allowPath(fs.realpathSync(f.filePath))) {
        throw new CldshError(CODES.FORBIDDEN, `Access to ${f.filePath} is not allowed`);
      }
    }
  }

  const items = files.map(({ filePath, relPath }) => {
    const resourceType = forced || classifyFile(filePath);
    const ext = extensionOf(filePath);
    let itemFolder;
    let itemName;
    if (!isDirectory && name) {
      const p = resolveRemote(target, name);
      itemFolder = parentOf(p);
      itemName = baseName(p);
      if (!itemName) throw usageError(`Invalid name: ${name}`);
      // Raw public IDs carry their extension; add it when the custom name doesn't.
      if (resourceType === 'raw' && ext && !itemName.toLowerCase().endsWith(`.${ext}`)) itemName += `.${ext}`;
    } else {
      const relDir = path.posix.dirname(relPath);
      itemFolder = relDir === '.' ? target : join(target, relDir);
      const base = path.posix.basename(relPath);
      itemName = resourceType === 'raw' || !ext ? base : base.slice(0, -(ext.length + 1));
    }
    return {
      filePath,
      relPath,
      folder: itemFolder,
      name: itemName,
      publicId: join(itemFolder, itemName),
      resourceType,
      bytes: isDirectory ? fs.statSync(filePath).size : stat.size,
      hasCollision: false,
      ext,
    };
  });

  // Two files would get the same public ID within one resource type (photo.jpg + photo.png):
  // suffix both with their extension.
  const counts = new Map();
  const key = (it) => `${it.resourceType}\0${it.publicId}`;
  for (const it of items) counts.set(key(it), (counts.get(key(it)) || 0) + 1);
  for (const it of items) {
    if (counts.get(key(it)) > 1 && it.ext) {
      it.hasCollision = true;
      it.name = `${it.name}_${it.ext}`;
      it.publicId = join(it.folder, it.name);
    }
  }
  for (const it of items) delete it.ext;

  return { localPath: abs, isDirectory, folder: target, recursive: Boolean(recursive), skippedDirectories, items, total: items.length };
}

// 499 is the SDK's own "Request Timeout".
const isTransient = (err) =>
  err.code === CODES.RATE_LIMITED || err.code === CODES.NETWORK || err.httpCode === 499 || (Number(err.httpCode) >= 500);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Chunked upload. The SDK's `upload_large` reports through its callback: it returns the chunking
 * stream, not a promise. That stream emits `ready` when it hands the next chunk to the network,
 * which happens only after the previous chunk was accepted, so the bytes of all earlier chunks
 * are confirmed sent. `onChunk(sentBytes)` is called then, and once more with the full size.
 */
function uploadLarge(sdk, file, options, bytes, onChunk) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, res) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else {
        onChunk?.(bytes);
        resolve(res);
      }
    };
    let ret;
    try {
      ret = sdk.uploader.upload_large(file, options, (err, res) => finish(err, res));
    } catch (e) {
      finish(e);
      return;
    }
    if (onChunk && ret && typeof ret.on === 'function') {
      let sent = 0;
      ret.on('ready', (buffer) => {
        if (sent > 0) onChunk(sent);
        sent += buffer?.length || 0;
      });
    }
    if (ret && typeof ret.then === 'function') ret.then(res => finish(null, res), err => finish(err));
  });
}

function statusOf(res, overwrite) {
  if (!overwrite && res?.existing === true) return 'skipped';
  return res?.overwritten ? 'overwritten' : 'created';
}

async function uploadOne(backend, item, { overwrite, includeResponse, retryDelayMs, largeFileBytes, chunkBytes, onChunk }) {
  const params = {
    ...backend.uploadParams({ folder: item.folder, name: item.name }),
    resource_type: item.resourceType,
    overwrite,
  };
  const large = item.bytes > largeFileBytes;
  const chunkProgress = onChunk ? (sent) => onChunk(item, sent, item.bytes) : undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = large
        ? await uploadLarge(backend.sdk, item.filePath, { ...params, chunk_size: chunkBytes }, item.bytes, chunkProgress)
        : await backend.sdk.uploader.upload(item.filePath, params);
      return {
        ...item,
        status: statusOf(res, overwrite),
        url: res?.secure_url || res?.url || null,
        asset_id: res?.asset_id,
        chunked: large,
        attempts: attempt,
        ...(includeResponse ? { response: res } : {}),
      };
    } catch (e) {
      const err = toCldError(e);
      if (attempt >= MAX_ATTEMPTS || !isTransient(err)) {
        return { ...item, status: 'failed', chunked: large, attempts: attempt, error: err.message, error_code: err.code, ...(err.hint ? { error_hint: err.hint } : {}) };
      }
      // Exponential backoff with jitter: ~1x, ~2x the base delay.
      await sleep(retryDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random()));
    }
  }
}

export function summarizeUpload(items) {
  const summary = { total: items.length, created: 0, overwritten: 0, skipped: 0, failed: 0 };
  for (const it of items) summary[it.status]++;
  return summary;
}

/**
 * Upload a plan from `planUpload`.
 * @param {object} [o]
 * @param {boolean} [o.overwrite=true] replace existing assets with the same public ID
 * @param {number} [o.concurrency=4] parallel uploads (1..10)
 * @param {(done: number, total: number, item: object) => void} [o.onProgress] called when a file finishes
 * @param {(item: object, sentBytes: number, totalBytes: number) => void} [o.onChunk] byte progress of
 *   chunked (large) uploads, called after each confirmed chunk and at the end
 * @param {boolean} [o.includeResponse] keep the raw upload response on each item
 * @returns {Promise<{ items: object[], summary: object }>}
 */
export async function executeUpload(backend, plan, {
  overwrite = true,
  concurrency = DEFAULT_CONCURRENCY,
  onProgress,
  onChunk,
  includeResponse = false,
  retryDelayMs = 500,
  largeFileBytes = LARGE_FILE_BYTES,
  chunkBytes = LARGE_FILE_BYTES,
} = {}) {
  const total = plan.items.length;
  let done = 0;
  try {
    const items = await runPool(plan.items, clampConcurrency(concurrency), async (item) => {
      const result = await uploadOne(backend, item, { overwrite: Boolean(overwrite), includeResponse, retryDelayMs, largeFileBytes, chunkBytes, onChunk });
      onProgress?.(++done, total, result);
      return result;
    });
    return {
      localPath: plan.localPath,
      isDirectory: plan.isDirectory,
      folder: plan.folder,
      overwrite: Boolean(overwrite),
      items,
      summary: summarizeUpload(items),
    };
  } finally {
    backend.invalidate();
  }
}
