// In-memory model of a Cloudinary product environment, used to test cldsh without network access.
//
// It reproduces the API behavior cldsh depends on (checked against live Free-plan clouds in
// dynamic folder mode): folder-mode semantics, paging, 1000-asset chunks for
// prefix deletes, "Folder is not empty", `{ result: 'not found' }` from destroy, errors as plain
// objects `{ error: { message, http_code } }`, and rate-limit counters.
//
// `installFake(v2, fake)` patches the real SDK singleton's `api`, `uploader` and `search` objects,
// so production code is exercised unchanged (URL generation stays the real SDK's).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RESOURCE_TYPES = ['image', 'video', 'raw'];
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'bmp', 'tif', 'tiff', 'ico', 'avif', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.split('/').pop();
const inSubtree = (p, root) => (root === '' ? true : p === root || p.startsWith(root + '/'));

function apiError(httpCode, message) {
  // Same shape the SDK rejects with.
  return { error: { message, http_code: httpCode }, request_options: {}, query_params: {} };
}

function page(items, { max_results, next_cursor } = {}, { def = Infinity, cap = 500 } = {}) {
  const size = Math.min(max_results ?? def, cap);
  const start = next_cursor ? Number(next_cursor) : 0;
  const slice = items.slice(start, start + size);
  const next = start + size < items.length ? String(start + size) : undefined;
  return { slice, next_cursor: next };
}

export function createFakeCloudinary({ folderMode = 'dynamic', cloudName = 'fake-cloud', rateLimit = 500, state } = {}) {
  const s = state ?? {
    folderMode,
    cloudName,
    folders: [],
    assets: [],
    rate: { allowed: rateLimit, remaining: rateLimit },
    seq: 0,
  };
  const calls = [];
  const failures = [];

  const folders = new Set(s.folders);
  const assets = new Map(s.assets.map(a => [a.asset_id, a]));

  const snapshot = () => ({ ...s, folders: [...folders].sort(), assets: [...assets.values()] });

  const record = (method, args) => calls.push({ method, args: JSON.parse(JSON.stringify(args ?? null)) });

  function maybeFail(method) {
    const i = failures.findIndex(f => f.method === method || f.method === '*');
    if (i === -1) return;
    const f = failures[i];
    if (--f.times <= 0) failures.splice(i, 1);
    throw f.error;
  }

  function adminCall(method, args) {
    record(method, args);
    maybeFail(method);
    if (s.rate.remaining <= 0) throw apiError(420, 'Rate Limit Exceeded');
    s.rate.remaining -= 1;
    return { rate_limit_allowed: s.rate.allowed, rate_limit_remaining: s.rate.remaining, rate_limit_reset_at: new Date(Date.now() + 3600e3).toISOString() };
  }

  function uploadCall(method, args) {
    record(method, args);
    maybeFail(method);
  }

  const folderOfAsset = (a) => (s.folderMode === 'dynamic' ? a.asset_folder : parentOf(a.public_id));

  function allFolders() {
    const set = new Set(folders);
    if (s.folderMode === 'fixed') {
      for (const a of assets.values()) {
        let p = parentOf(a.public_id);
        while (p) { set.add(p); p = parentOf(p); }
      }
    }
    return set;
  }

  function addFolder(p) {
    while (p) { folders.add(p); p = parentOf(p); }
  }

  const findAsset = (publicId, resourceType = 'image', type = 'upload') =>
    [...assets.values()].find(a => a.public_id === publicId && a.resource_type === resourceType && a.type === type);

  function deliveryUrl(a) {
    const ext = a.resource_type === 'raw' || !a.format ? '' : `.${a.format}`;
    return `https://res.cloudinary.com/${s.cloudName}/${a.resource_type}/${a.type}/v${a.version}/${a.public_id}${ext}`;
  }

  function view(a) {
    const out = {
      asset_id: a.asset_id,
      public_id: a.public_id,
      resource_type: a.resource_type,
      type: a.type,
      format: a.format,
      version: a.version,
      bytes: a.bytes,
      width: a.width,
      height: a.height,
      created_at: a.created_at,
      tags: a.tags || [],
      url: deliveryUrl(a).replace('https://', 'http://'),
      secure_url: deliveryUrl(a),
    };
    if (s.folderMode === 'dynamic') {
      out.asset_folder = a.asset_folder;
      out.display_name = a.display_name;
    } else {
      out.folder = parentOf(a.public_id);
    }
    if (out.format === undefined) delete out.format;
    return out;
  }

  function classify(file, resourceType) {
    const ext = String(file).split(/[?#]/)[0].split('.').pop().toLowerCase();
    if (resourceType && resourceType !== 'auto') return resourceType;
    if (IMAGE_EXT.has(ext)) return 'image';
    if (VIDEO_EXT.has(ext)) return 'video';
    return 'raw';
  }

  function readBytes(file) {
    if (typeof file === 'string' && file.startsWith('data:')) return Buffer.from(file.split(',')[1] || '', 'base64');
    try { return fs.readFileSync(file); } catch { return null; }
  }

  function doUpload(file, options = {}) {
    const bytes = readBytes(file);
    if (!bytes) throw apiError(400, `File not found: ${file}`);
    // Server-side SDK uploads default to resource_type 'image' (not 'auto').
    const resource_type = classify(file, options.resource_type ?? 'image');
    const type = options.type || 'upload';
    const local = typeof file === 'string' && !file.startsWith('data:') ? path.basename(file) : 'file';
    const ext = local.includes('.') ? local.split('.').pop().toLowerCase() : undefined;
    const public_id = options.public_id || `${local.replace(/\.[^.]+$/, '')}_${crypto.randomBytes(3).toString('hex')}`;
    if (resource_type === 'image' && ext && !IMAGE_EXT.has(ext)) throw apiError(400, 'Invalid image file');
    if (resource_type === 'video' && ext && !VIDEO_EXT.has(ext)) throw apiError(400, 'Invalid video file');
    const existing = findAsset(public_id, resource_type, type);
    const overwrite = options.overwrite !== undefined ? Boolean(options.overwrite) : true;
    if (existing && !overwrite) {
      return { ...view(existing), existing: true };
    }
    const asset_folder = s.folderMode === 'dynamic' ? (options.asset_folder ?? '') : undefined;
    const asset = existing ?? {
      asset_id: crypto.randomBytes(16).toString('hex'),
      public_id,
      resource_type,
      type,
      created_at: new Date().toISOString(),
    };
    Object.assign(asset, {
      format: resource_type === 'raw' ? undefined : ext,
      bytes: bytes.length,
      width: resource_type === 'raw' ? undefined : 1,
      height: resource_type === 'raw' ? undefined : 1,
      version: 1700000000 + (++s.seq),
      content: bytes.toString('base64'),
    });
    if (s.folderMode === 'dynamic') {
      if (!existing) {
        asset.asset_folder = asset_folder;
        asset.display_name = options.display_name || baseOf(public_id);
      }
      addFolder(asset.asset_folder);
    }
    assets.set(asset.asset_id, asset);
    return { ...view(asset), overwritten: Boolean(existing), original_filename: local.replace(/\.[^.]+$/, '') };
  }

  const api = {
    async ping() { return { status: 'ok', ...adminCall('ping', []) }; },

    async config(options = {}) {
      const meta = adminCall('config', [options]);
      const out = { cloud_name: s.cloudName, created_at: '2026-01-01T00:00:00Z', ...meta };
      if (options.settings) out.settings = { folder_mode: s.folderMode };
      return out;
    },

    async usage() { return { plan: 'Free', ...adminCall('usage', []) }; },

    async root_folders(options = {}) {
      const meta = adminCall('root_folders', [options]);
      const roots = [...allFolders()].filter(p => !p.includes('/')).sort();
      const { slice, next_cursor } = page(roots, options);
      return { folders: slice.map(p => ({ name: p, path: p })), next_cursor, total_count: roots.length, ...meta };
    },

    async sub_folders(p, options = {}) {
      const meta = adminCall('sub_folders', [p, options]);
      const all = allFolders();
      if (!all.has(p)) throw apiError(404, `Can't find folder with path ${p}`);
      const subs = [...all].filter(f => parentOf(f) === p).sort();
      const { slice, next_cursor } = page(subs, options);
      return { folders: slice.map(f => ({ name: baseOf(f), path: f })), next_cursor, total_count: subs.length, ...meta };
    },

    async create_folder(p) {
      const meta = adminCall('create_folder', [p]);
      addFolder(p);
      return { success: true, path: p, name: baseOf(p), ...meta };
    },

    async delete_folder(p, options = {}) {
      const meta = adminCall('delete_folder', [p, options]);
      const all = allFolders();
      if (!all.has(p)) throw apiError(404, `Can't find folder with path ${p}`);
      const busy = [...assets.values()].some(a => inSubtree(folderOfAsset(a), p));
      if (busy) throw apiError(400, 'Folder is not empty');
      const deleted = [...folders].filter(f => inSubtree(f, p));
      for (const f of deleted) folders.delete(f);
      return { deleted, ...meta };
    },

    async rename_folder(from, to) {
      const meta = adminCall('rename_folder', [from, to]);
      if (s.folderMode !== 'dynamic') throw apiError(400, 'Renaming folders is not supported in fixed folder mode');
      if (!folders.has(from)) throw apiError(404, `Can't find folder with path ${from}`);
      for (const f of [...folders].filter(f => inSubtree(f, from))) {
        folders.delete(f);
        folders.add(to + f.slice(from.length));
      }
      addFolder(to);
      for (const a of assets.values()) {
        if (inSubtree(a.asset_folder, from)) a.asset_folder = to + a.asset_folder.slice(from.length);
      }
      return { from: { name: baseOf(from), path: from }, to: { name: baseOf(to), path: to }, ...meta };
    },

    async resources(options = {}) {
      const meta = adminCall('resources', [options]);
      const rt = options.resource_type || 'image';
      const list = [...assets.values()]
        .filter(a => a.resource_type === rt)
        .filter(a => !options.type || a.type === options.type)
        .filter(a => !options.prefix || a.public_id.startsWith(options.prefix))
        .sort((a, b) => a.public_id.localeCompare(b.public_id));
      const { slice, next_cursor } = page(list, options, { def: 10 });
      return { resources: slice.map(view), next_cursor, ...meta };
    },

    async resources_by_asset_folder(folder, options = {}) {
      const meta = adminCall('resources_by_asset_folder', [folder, options]);
      if (s.folderMode !== 'dynamic') throw apiError(404, 'Not Found');
      const list = [...assets.values()]
        .filter(a => a.asset_folder === folder)
        .sort((a, b) => a.public_id.localeCompare(b.public_id));
      const { slice, next_cursor } = page(list, options, { def: 50 });
      return { resources: slice.map(view), next_cursor, total_count: list.length, ...meta };
    },

    async resources_by_asset_ids(ids, options = {}) {
      const meta = adminCall('resources_by_asset_ids', [ids, options]);
      return { resources: ids.map(id => assets.get(id)).filter(Boolean).map(view), ...meta };
    },

    async resources_by_ids(publicIds, options = {}) {
      const meta = adminCall('resources_by_ids', [publicIds, options]);
      const rt = options.resource_type || 'image';
      const type = options.type || 'upload';
      return { resources: publicIds.map(id => findAsset(id, rt, type)).filter(Boolean).map(view), ...meta };
    },

    async resource(publicId, options = {}) {
      const meta = adminCall('resource', [publicId, options]);
      const a = findAsset(publicId, options.resource_type || 'image', options.type || 'upload');
      if (!a) throw apiError(404, `Resource not found - ${publicId}`);
      return { ...view(a), ...meta };
    },

    async update(publicId, options = {}) {
      const meta = adminCall('update', [publicId, options]);
      const a = findAsset(publicId, options.resource_type || 'image', options.type || 'upload');
      if (!a) throw apiError(404, `Resource not found - ${publicId}`);
      if (options.asset_folder !== undefined) {
        if (s.folderMode !== 'dynamic') throw apiError(400, 'asset_folder is not supported in fixed folder mode');
        a.asset_folder = options.asset_folder;
        addFolder(a.asset_folder);
      }
      if (options.display_name !== undefined) a.display_name = options.display_name;
      return { ...view(a), ...meta };
    },

    async delete_resources(publicIds, options = {}) {
      const meta = adminCall('delete_resources', [publicIds, options]);
      const deleted = {};
      for (const id of publicIds) {
        const a = findAsset(id, options.resource_type || 'image', options.type || 'upload');
        if (a) { assets.delete(a.asset_id); deleted[id] = 'deleted'; } else deleted[id] = 'not_found';
      }
      return { deleted, partial: false, ...meta };
    },

    async delete_resources_by_prefix(prefix, options = {}) {
      const meta = adminCall('delete_resources_by_prefix', [prefix, options]);
      const matching = [...assets.values()].filter(a =>
        a.public_id.startsWith(prefix) && a.resource_type === (options.resource_type || 'image') && a.type === (options.type || 'upload'));
      const chunk = matching.slice(0, 1000);
      const deleted = {};
      for (const a of chunk) { assets.delete(a.asset_id); deleted[a.public_id] = 'deleted'; }
      const partial = matching.length > 1000;
      return { deleted, partial, ...(partial ? { next_cursor: 'more' } : {}), ...meta };
    },

    async delete_resources_by_asset_ids(ids, options = {}) {
      const meta = adminCall('delete_resources_by_asset_ids', [ids, options]);
      const deleted = {};
      for (const id of ids) {
        if (assets.has(id)) { assets.delete(id); deleted[id] = 'deleted'; } else deleted[id] = 'not_found';
      }
      return { deleted, partial: false, ...meta };
    },
  };

  const uploader = {
    async upload(file, options = {}) {
      uploadCall('upload', [typeof file === 'string' && file.startsWith('data:') ? 'data:' : file, options]);
      return doUpload(file, options);
    },

    async upload_large(file, options = {}) {
      uploadCall('upload_large', [file, options]);
      return doUpload(file, options);
    },

    async destroy(publicId, options = {}) {
      uploadCall('destroy', [publicId, options]);
      const a = findAsset(publicId, options.resource_type || 'image', options.type || 'upload');
      if (!a) return { result: 'not found' };
      assets.delete(a.asset_id);
      return { result: 'ok' };
    },

    async rename(from, to, options = {}) {
      uploadCall('rename', [from, to, options]);
      const rt = options.resource_type || 'image';
      const type = options.type || 'upload';
      const a = findAsset(from, rt, type);
      if (!a) throw apiError(404, `Resource not found - ${from}`);
      const clash = findAsset(to, rt, options.to_type || type);
      if (clash && clash !== a) {
        if (!options.overwrite) throw apiError(400, `to_public_id(${to}) already exists`);
        assets.delete(clash.asset_id);
      }
      a.public_id = to;
      a.version = 1700000000 + (++s.seq);
      return view(a);
    },
  };

  return {
    api,
    uploader,
    calls,
    get state() { return snapshot(); },
    get folderMode() { return s.folderMode; },
    /** Make the next `times` calls to `method` ('*' = any) reject with `error` (default: 500). */
    failNext(method, { times = 1, error = apiError(500, 'Internal server error') } = {}) {
      failures.push({ method, times, error });
    },
    setRateRemaining(n) { s.rate.remaining = n; },
    /** Seed an asset directly (no call recorded). */
    seed({ public_id, resource_type = 'image', type = 'upload', asset_folder, display_name, format, bytes = 1024, content }) {
      const asset = {
        asset_id: crypto.randomBytes(16).toString('hex'),
        public_id,
        resource_type,
        type,
        format: resource_type === 'raw' ? undefined : (format ?? 'png'),
        bytes,
        width: resource_type === 'raw' ? undefined : 100,
        height: resource_type === 'raw' ? undefined : 80,
        version: 1700000000 + (++s.seq),
        created_at: new Date().toISOString(),
        content: content ?? Buffer.alloc(Math.min(bytes, 64), 1).toString('base64'),
      };
      if (s.folderMode === 'dynamic') {
        asset.asset_folder = asset_folder ?? parentOf(public_id);
        asset.display_name = display_name ?? baseOf(public_id);
        addFolder(asset.asset_folder);
      }
      assets.set(asset.asset_id, asset);
      return view(asset);
    },
    seedFolder(p) { addFolder(p); },
    /** Bytes served for a delivery URL or a private download URL (used by the fetch shim). */
    contentForUrl(url) {
      const download = url.match(/^https:\/\/api\.cloudinary\.com\/v1_1\/([^/]+)\/(image|video|raw)\/download\?(.*)$/);
      if (download) {
        const q = new URLSearchParams(download[3]);
        const a = download[1] === s.cloudName && q.get('signature') ? findAsset(q.get('public_id'), download[2], q.get('type') || 'upload') : null;
        return a ? Buffer.from(a.content || '', 'base64') : null;
      }
      for (const a of assets.values()) {
        const tail = `${a.public_id}${a.resource_type === 'raw' || !a.format ? '' : '.' + a.format}`;
        if (url.startsWith(`https://res.cloudinary.com/${s.cloudName}/${a.resource_type}/`) && (url.includes(`/${tail}`) || url.includes(`/${a.public_id}.`))) {
          return Buffer.from(a.content || '', 'base64');
        }
      }
      return null;
    },
    RESOURCE_TYPES,
  };
}

/** Patch the real SDK singleton with the fake. Returns a restore function. */
export function installFake(v2, fake) {
  const saved = { api: { ...v2.api }, uploader: { ...v2.uploader } };
  Object.assign(v2.api, fake.api);
  Object.assign(v2.uploader, fake.uploader);
  return () => {
    for (const k of Object.keys(fake.api)) v2.api[k] = saved.api[k];
    for (const k of Object.keys(fake.uploader)) v2.uploader[k] = saved.uploader[k];
  };
}

/** Replace global fetch for res.cloudinary.com URLs of the fake cloud. Returns a restore function. */
export function installFetchShim(fake) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://res.cloudinary.com/') || /^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/(image|video|raw)\/download\?/.test(u)) {
      fake.calls.push({ method: 'fetch', args: [u] });
      const body = fake.contentForUrl(u);
      if (!body) return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      return new Response(body, { status: 200 });
    }
    return real(url, init);
  };
  return () => { globalThis.fetch = real; };
}
