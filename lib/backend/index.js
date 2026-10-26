// Storage backend: the only layer that knows how Cloudinary stores folders.
//
// Cloudinary product environments run in one of two folder modes (see
// https://cloudinary.com/documentation/folder_modes):
// - dynamic (every account created since June 2024): an asset's folder is its `asset_folder`,
//   independent of its `public_id`. Listing uses `resources_by_asset_folder`, moving uses `update`.
// - fixed (legacy): the folder is the `public_id` path. Listing uses `resources` by prefix,
//   moving uses `rename`.
// Commands and MCP tools call this module only; they never assume a folder mode.
import process from 'node:process';
import { cloudinary } from '../sdk.js';
import { CldshError, CODES, toCldError, usageError } from '../errors.js';
import { norm, join, parentOf, baseName, isWithin, resolveRemote } from '../paths.js';
import { isGlob, parseGlobTarget } from '../glob.js';
import { getCachedMode, setCachedMode } from './mode-cache.js';

export const RESOURCE_TYPES = ['image', 'video', 'raw'];
export const DELIVERY_TYPES = ['upload', 'private', 'authenticated'];
const PAGE = 500;
const DELETE_BATCH = 100;
const CACHE_TTL_MS = 15_000;

/** Normalized asset reference used everywhere above this layer. */
export function toRef(r, mode) {
  const folder = mode === 'dynamic' ? norm(r.asset_folder ?? '') : norm(r.folder ?? parentOf(r.public_id));
  const name = mode === 'dynamic' ? (r.display_name || baseName(r.public_id)) : baseName(r.public_id);
  return {
    asset_id: r.asset_id,
    public_id: r.public_id,
    resource_type: r.resource_type,
    type: r.type,
    folder,
    name,
    format: r.format,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    version: r.version,
    created_at: r.created_at,
    tags: r.tags,
    secure_url: r.secure_url,
    url: r.url,
  };
}

/** Does the ref match a (non-glob) name or a glob regex? Matches display name, `name.format` and public ID basename. */
function refMatches(ref, test) {
  const base = baseName(ref.public_id);
  const candidates = [ref.name, base];
  if (ref.format) candidates.push(`${ref.name}.${ref.format}`, `${base}.${ref.format}`);
  return candidates.some(test);
}

const sortRefs = (refs) => refs.sort((a, b) => a.name.localeCompare(b.name) || a.public_id.localeCompare(b.public_id));

export class Backend {
  constructor({ mode, cloudName, sdk = cloudinary }) {
    this.mode = mode;
    this.cloudName = cloudName;
    this.sdk = sdk;
    this.rate = null;
    this.cache = new Map();
  }

  // ---------------------------------------------------------------- plumbing

  async call(fn) {
    let res;
    try {
      res = await fn();
    } catch (e) {
      throw toCldError(e);
    }
    if (res && typeof res === 'object' && res.rate_limit_allowed !== undefined) {
      this.rate = {
        allowed: Number(res.rate_limit_allowed),
        remaining: Number(res.rate_limit_remaining),
        resetAt: res.rate_limit_reset_at ? new Date(res.rate_limit_reset_at).toISOString() : null,
      };
    }
    return res;
  }

  /** True when less than 10% of the hourly Admin API budget is left. */
  get rateLow() {
    return Boolean(this.rate && this.rate.allowed && this.rate.remaining / this.rate.allowed < 0.1);
  }

  async cached(key, load) {
    const hit = this.cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    const value = await load();
    this.cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** Drop cached listings. Called after every write. */
  invalidate() {
    this.cache.clear();
  }

  // ---------------------------------------------------------------- folders

  /** Names of the immediate subfolders of `folder` ('' = root), sorted. Pages through everything. */
  async listFolders(folder = '') {
    const f = norm(folder);
    return this.cached(`folders:${f}`, async () => {
      const names = [];
      let next_cursor;
      do {
        const opts = { max_results: PAGE, ...(next_cursor ? { next_cursor } : {}) };
        const res = await this.call(() => (f ? this.sdk.api.sub_folders(f, opts) : this.sdk.api.root_folders(opts)));
        for (const x of res.folders || []) names.push(x.name);
        next_cursor = res.next_cursor;
      } while (next_cursor);
      return names.sort((a, b) => a.localeCompare(b));
    });
  }

  /** Whether a folder exists. Costs one (cached) listing of its parent. */
  async folderExists(folder) {
    const f = norm(folder);
    if (!f) return true;
    try {
      const siblings = await this.listFolders(parentOf(f));
      return siblings.includes(baseName(f));
    } catch (e) {
      if (e.code === CODES.NOT_FOUND) return false;
      throw e;
    }
  }

  async requireFolder(folder, display = folder) {
    if (!(await this.folderExists(folder))) {
      throw new CldshError(CODES.NOT_FOUND, `No such folder: ${display || '/'}`);
    }
  }

  /** All descendant folder paths of `folder`, parents before children. */
  async walkFolders(folder = '') {
    const out = [];
    const queue = [norm(folder)];
    while (queue.length) {
      const f = queue.shift();
      for (const name of await this.listFolders(f)) {
        const child = join(f, name);
        out.push(child);
        queue.push(child);
      }
    }
    return out;
  }

  async createFolder(folder) {
    const f = norm(folder);
    if (!f) throw usageError('mkdir needs a folder name');
    const res = await this.call(() => this.sdk.api.create_folder(f));
    this.invalidate();
    return { path: res.path ?? f, name: res.name ?? baseName(f) };
  }

  /**
   * Delete a folder whose assets have already been deleted, including its (empty) descendants.
   * Dynamic mode deletes the whole empty subtree in one call (verified live). Fixed mode deletes
   * deepest-first, which works whatever its server-side semantics are.
   */
  async deleteFolder(folder, { skipBackup = false } = {}) {
    const f = norm(folder);
    if (!f) throw usageError('The root folder cannot be deleted');
    const opts = skipBackup ? { skip_backup: true } : {};
    try {
      if (this.mode === 'dynamic') {
        const res = await this.call(() => this.sdk.api.delete_folder(f, opts));
        return res.deleted ?? [f];
      }
      const descendants = await this.walkFolders(f);
      const deleted = [];
      for (const d of [...descendants].reverse()) {
        await this.call(() => this.sdk.api.delete_folder(d, opts));
        deleted.push(d);
      }
      await this.call(() => this.sdk.api.delete_folder(f, opts));
      deleted.push(f);
      return deleted;
    } finally {
      this.invalidate();
    }
  }

  async renameFolder(from, to) {
    const a = norm(from);
    const b = norm(to);
    if (this.mode !== 'dynamic') {
      throw new CldshError(CODES.UNSUPPORTED, 'Moving or renaming folders is not supported by Cloudinary in fixed folder mode', {
        hint: 'Move the assets individually, or ask Cloudinary support to migrate the product environment to dynamic folders.',
      });
    }
    if (!a) throw usageError('The root folder cannot be moved');
    if (isWithin(b, a)) throw usageError(`Cannot move folder ${a} into itself`);
    try {
      await this.call(() => this.sdk.api.rename_folder(a, b));
    } finally {
      this.invalidate();
    }
    return { from: a, to: b };
  }

  // ---------------------------------------------------------------- assets

  /**
   * Assets directly inside `folder` (not in subfolders).
   * @returns {Promise<{ assets: object[], truncated: boolean }>}
   */
  async listAssets(folder = '', { resourceTypes = RESOURCE_TYPES, deliveryTypes = ['upload'], max = Infinity } = {}) {
    const f = norm(folder);
    const wantRt = new Set(resourceTypes);
    const wantType = new Set(deliveryTypes);
    const keep = (r) => wantRt.has(r.resource_type) && wantType.has(r.type);

    if (this.mode === 'dynamic') {
      // One listing covers every resource and delivery type.
      const all = await this.cached(`assets:${f}`, async () => {
        const out = [];
        let next_cursor;
        do {
          const res = await this.call(() => this.sdk.api.resources_by_asset_folder(f, { max_results: PAGE, ...(next_cursor ? { next_cursor } : {}) }));
          for (const r of res.resources || []) out.push(toRef(r, 'dynamic'));
          next_cursor = res.next_cursor;
        } while (next_cursor);
        return out;
      });
      const filtered = sortRefs(all.filter(keep));
      return { assets: filtered.slice(0, max), truncated: filtered.length > max };
    }

    // Fixed mode: list by public ID prefix per resource/delivery type and keep immediate children.
    // The prefix listing also returns assets of subfolders, so its cost grows with the subtree.
    const out = [];
    let truncated = false;
    const prefix = f ? `${f}/` : '';
    for (const rt of resourceTypes) {
      for (const type of deliveryTypes) {
        const list = await this.cached(`assets:${f}:${rt}:${type}`, async () => {
          const acc = [];
          let next_cursor;
          do {
            const res = await this.call(() => this.sdk.api.resources({
              resource_type: rt, type, max_results: PAGE, ...(prefix ? { prefix } : {}), ...(next_cursor ? { next_cursor } : {}),
            }));
            for (const r of res.resources || []) {
              if (!r.public_id.slice(prefix.length).includes('/')) acc.push(toRef(r, 'fixed'));
            }
            next_cursor = res.next_cursor;
          } while (next_cursor);
          return acc;
        });
        out.push(...list);
      }
    }
    sortRefs(out);
    if (out.length > max) { truncated = true; out.length = max; }
    return { assets: out, truncated };
  }

  /** Every asset in `folder` and all its subfolders. */
  async listSubtree(folder = '', { resourceTypes = RESOURCE_TYPES, deliveryTypes = DELIVERY_TYPES } = {}) {
    const f = norm(folder);
    if (this.mode === 'dynamic') {
      const out = [];
      for (const dir of [f, ...(await this.walkFolders(f))]) {
        out.push(...(await this.listAssets(dir, { resourceTypes, deliveryTypes })).assets);
      }
      return out;
    }
    const out = [];
    const prefix = f ? `${f}/` : '';
    for (const rt of resourceTypes) {
      for (const type of deliveryTypes) {
        let next_cursor;
        do {
          const res = await this.call(() => this.sdk.api.resources({
            resource_type: rt, type, max_results: PAGE, ...(prefix ? { prefix } : {}), ...(next_cursor ? { next_cursor } : {}),
          }));
          for (const r of res.resources || []) out.push(toRef(r, 'fixed'));
          next_cursor = res.next_cursor;
        } while (next_cursor);
      }
    }
    return out;
  }

  /**
   * Find assets (and folders) in a folder matching a glob such as `cld*` or `shots/*.png`,
   * resolved against `cwd`.
   */
  async findByGlob(cwd, pattern, { resourceTypes = RESOURCE_TYPES, deliveryTypes = ['upload'], includeFolders = false } = {}) {
    const g = parseGlobTarget(cwd, pattern);
    if (!g) throw usageError(`Not a wildcard pattern: ${pattern}`);
    if (isGlob(g.folderPart)) throw usageError('Wildcards are only supported in the last path segment', 'e.g. "shots/cld*", not "sh*/cld*"');
    const folder = resolveRemote(cwd, g.folderPart || '.');
    await this.requireFolder(folder, g.folderPart || folder);
    const { assets } = await this.listAssets(folder, { resourceTypes, deliveryTypes });
    const matched = assets.filter(ref => refMatches(ref, s => g.regex.test(s)));
    const folders = includeFolders
      ? (await this.listFolders(folder)).filter(n => g.regex.test(n)).map(n => join(folder, n))
      : [];
    return { folder, assets: matched, folders };
  }

  /**
   * Resolve one asset argument: a name or path relative to `cwd`, a public ID, or `asset_id:<id>`.
   * Throws NOT_FOUND, or CONFLICT when a name matches several assets.
   */
  async resolveAsset(cwd, arg, { resourceType, deliveryType } = {}) {
    const raw = String(arg ?? '').trim();
    if (!raw) throw usageError('Expected an asset name or public ID');
    const resourceTypes = resourceType && resourceType !== 'all' ? [resourceType] : RESOURCE_TYPES;
    // Dynamic mode lists a folder in one call covering every delivery type; fixed mode looks up
    // public IDs directly, so it only tries `upload` unless --type says otherwise.
    const deliveryTypes = deliveryType ? [deliveryType] : (this.mode === 'dynamic' ? DELIVERY_TYPES : ['upload']);

    if (raw.startsWith('asset_id:')) {
      const id = raw.slice('asset_id:'.length);
      const res = await this.call(() => this.sdk.api.resources_by_asset_ids([id]));
      const r = (res.resources || [])[0];
      if (!r) throw new CldshError(CODES.NOT_FOUND, `No asset with asset_id ${id}`);
      return toRef(r, this.mode);
    }

    const p = resolveRemote(cwd, raw);
    if (!p) throw usageError(`"${raw}" is a folder, not an asset`);
    const folder = parentOf(p);
    const leaf = baseName(p);

    let matches = [];
    if (this.mode === 'dynamic' && await this.folderExists(folder)) {
      const { assets } = await this.listAssets(folder, { resourceTypes, deliveryTypes });
      const exact = assets.filter(r => r.public_id === p);
      matches = exact.length ? exact : assets.filter(ref => refMatches(ref, s => s === leaf));
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new CldshError(CODES.CONFLICT, `"${raw}" matches ${matches.length} assets`, {
        hint: 'Add --rt=image|video|raw or --type, or pass the full public ID.',
        details: matches.map(m => ({ public_id: m.public_id, resource_type: m.resource_type, type: m.type, asset_id: m.asset_id })),
      });
    }

    // Direct public ID lookup: fixed mode always; dynamic mode when the public ID path differs from
    // its folder. "hero.png" also tries "hero" (images and videos have no extension in the public ID).
    const ids = [p];
    const dot = leaf.lastIndexOf('.');
    if (dot > 0) ids.push(join(folder, leaf.slice(0, dot)));
    const lookupTypes = deliveryType ? [deliveryType] : ['upload'];
    for (const id of ids) {
      for (const rt of resourceTypes) {
        for (const type of lookupTypes) {
          try {
            const r = await this.call(() => this.sdk.api.resource(id, { resource_type: rt, type }));
            return toRef(r, this.mode);
          } catch (e) {
            if (e.code !== CODES.NOT_FOUND) throw e;
          }
        }
      }
    }
    throw new CldshError(CODES.NOT_FOUND, `No such asset: ${raw}`, {
      hint: resourceType ? undefined : 'Use "ls" to see the names in this folder.',
    });
  }

  /**
   * Delete assets. Returns one entry per ref: { ref, status: 'deleted' | 'not_found' | 'failed', error? }.
   */
  async deleteAssets(refs) {
    const results = [];
    try {
      if (this.mode === 'dynamic') {
        for (let i = 0; i < refs.length; i += DELETE_BATCH) {
          const batch = refs.slice(i, i + DELETE_BATCH);
          try {
            const res = await this.call(() => this.sdk.api.delete_resources_by_asset_ids(batch.map(r => r.asset_id)));
            for (const ref of batch) results.push(statusEntry(ref, res.deleted?.[ref.asset_id]));
          } catch (e) {
            for (const ref of batch) results.push({ ref, status: 'failed', error: e.message });
          }
        }
        return results;
      }
      const groups = new Map();
      for (const ref of refs) {
        const key = `${ref.resource_type}/${ref.type}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ref);
      }
      for (const group of groups.values()) {
        for (let i = 0; i < group.length; i += DELETE_BATCH) {
          const batch = group.slice(i, i + DELETE_BATCH);
          const { resource_type, type } = batch[0];
          try {
            const res = await this.call(() => this.sdk.api.delete_resources(batch.map(r => r.public_id), { resource_type, type }));
            for (const ref of batch) results.push(statusEntry(ref, res.deleted?.[ref.public_id]));
          } catch (e) {
            for (const ref of batch) results.push({ ref, status: 'failed', error: e.message });
          }
        }
      }
      return results;
    } finally {
      this.invalidate();
    }
  }

  /**
   * Move and/or rename an asset.
   * - dynamic: moving updates `asset_folder` (URL unchanged); renaming updates `display_name`
   *   unless `changePublicId`, which renames the public ID (URL changes).
   * - fixed: the folder is the public ID path, so any move or rename renames the public ID.
   * @returns {Promise<{ before: object, after: object, urlChanged: boolean }>}
   */
  async moveAsset(ref, { toFolder, newName, changePublicId = false, overwrite = false } = {}) {
    const targetFolder = toFolder === undefined ? ref.folder : norm(toFolder);
    const name = newName || undefined;
    const opts = { resource_type: ref.resource_type, type: ref.type };
    try {
      if (this.mode === 'dynamic' && !changePublicId) {
        let r = null;
        if (targetFolder !== ref.folder || (name && name !== ref.name)) {
          r = await this.call(() => this.sdk.api.update(ref.public_id, {
            ...opts,
            ...(targetFolder !== ref.folder ? { asset_folder: targetFolder } : {}),
            ...(name && name !== ref.name ? { display_name: name } : {}),
          }));
        }
        return { before: ref, after: r ? toRef(r, 'dynamic') : ref, urlChanged: false };
      }

      const newPublicId = join(targetFolder, name ?? baseName(ref.public_id));
      let r = null;
      if (newPublicId !== ref.public_id) {
        r = await this.call(() => this.sdk.uploader.rename(ref.public_id, newPublicId, { ...opts, overwrite, invalidate: true }));
      }
      let after = r ? toRef(r, this.mode) : ref;
      if (this.mode === 'dynamic' && targetFolder !== ref.folder) {
        const u = await this.call(() => this.sdk.api.update(newPublicId, { ...opts, asset_folder: targetFolder }));
        after = toRef(u, 'dynamic');
      }
      return { before: ref, after, urlChanged: newPublicId !== ref.public_id };
    } finally {
      this.invalidate();
    }
  }

  /** Folder-related upload parameters for an asset named `name` in `folder`. */
  uploadParams({ folder = '', name }) {
    const f = norm(folder);
    const public_id = join(f, name);
    if (this.mode === 'dynamic') {
      // Keep the folder in the public ID (same URLs as cldsh 1.0.0) and place the asset in that folder.
      return { public_id, ...(f ? { asset_folder: f } : {}), use_asset_folder_as_public_id_prefix: false };
    }
    return { public_id };
  }

  async ping() {
    return this.call(() => this.sdk.api.ping());
  }
}

function statusEntry(ref, status) {
  if (status === 'deleted') return { ref, status: 'deleted' };
  if (status === 'not_found' || status === undefined) return { ref, status: 'not_found' };
  return { ref, status: 'failed', error: String(status) };
}

// ---------------------------------------------------------------- lifecycle

let current = null;
let currentKey = null;
let modeOverride = null;

/** Force a folder mode (from --folder-mode); `null` restores detection. */
export function setFolderModeOverride(mode) {
  modeOverride = mode || null;
  current = null;
}

function envModeOverride() {
  const m = process.env.CLDSH_FOLDER_MODE;
  if (!m) return null;
  if (m !== 'fixed' && m !== 'dynamic') throw usageError(`CLDSH_FOLDER_MODE must be "fixed" or "dynamic" (got "${m}")`);
  return m;
}

/** Detect the product environment's folder mode. */
export async function detectFolderMode(sdk = cloudinary) {
  try {
    const res = await sdk.api.config({ settings: true });
    const m = res?.settings?.folder_mode;
    if (m === 'dynamic' || m === 'fixed') return m;
  } catch (e) {
    const err = toCldError(e);
    if (err.code === CODES.AUTH || err.code === CODES.NETWORK || err.code === CODES.RATE_LIMITED) throw err;
    // Restricted keys may not read `config`; fall through to the probe.
  }
  try {
    await sdk.api.resources_by_asset_folder('', { max_results: 1 });
    return 'dynamic';
  } catch (e) {
    const err = toCldError(e);
    if (err.code === CODES.NOT_FOUND) return 'fixed';
    throw err;
  }
}

/** Forget the current backend (credentials changed). */
export function resetBackend() {
  current = null;
  currentKey = null;
}

/**
 * The backend for the active account. `account` is { cloud_name, api_key } of the active credentials.
 */
export async function getBackend(account) {
  if (!account?.cloud_name) {
    throw new CldshError(CODES.NOT_CONFIGURED, 'Not connected to a Cloudinary account', {
      hint: 'Run "cldsh login", or set CLOUDINARY_URL in the environment or a .env file.',
    });
  }
  const key = `${account.cloud_name}:${account.api_key}`;
  if (current && currentKey === key) return current;
  let mode = modeOverride || envModeOverride() || getCachedMode(account.cloud_name);
  if (!mode) {
    mode = await detectFolderMode();
    setCachedMode(account.cloud_name, mode);
  }
  current = new Backend({ mode, cloudName: account.cloud_name });
  currentKey = key;
  return current;
}

/** The backend if it was already created (no network), else null. */
export function peekBackend() {
  return current;
}
