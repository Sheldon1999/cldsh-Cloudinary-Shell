import { v2 as cloudinary } from 'cloudinary';

export const norm = (p = '') => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
export const join = (a, b) => norm([norm(a), norm(b)].filter(Boolean).join('/'));

export function resolvePath(currentCwd = '', target = '') {
  const t = (target || '').trim();
  if (!t || t === '~' || t === '/') return '';

  let segments = [];
  if (t.startsWith('/') || t.startsWith('~')) {
    segments = t.replace(/^[~/]+/, '').split('/').filter(Boolean);
  } else {
    segments = [...(currentCwd ? currentCwd.split('/').filter(Boolean) : []), ...t.split('/').filter(Boolean)];
  }

  const resolved = [];
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return resolved.join('/');
}
export async function rootFolders() {
  const res = await cloudinary.api.root_folders();
  return res.folders?.map(f => f.name) || [];
}

export async function subFolders(folder) {
  const res = await cloudinary.api.sub_folders(norm(folder));
  return res.folders?.map(f => f.name) || [];
}

// List immediate files under a folder (no recursion)
export async function listFilesImmediate(folder, { max = 100, resource_type = 'image' } = {}) {
  const prefix = folder ? norm(folder) + '/' : '';
  const out = [];
  let next_cursor;
  do {
    const res = await cloudinary.api.resources({
      prefix,
      type: 'upload',
      resource_type,
      max_results: Math.min(500, max),
      next_cursor,
    });
    for (const r of res.resources || []) {
      const rel = prefix ? r.public_id.slice(prefix.length) : r.public_id;
      if (!rel.includes('/')) out.push(r); // keep only immediate files
      if (out.length >= max) break;
    }
    next_cursor = res.next_cursor;
  } while (next_cursor && out.length < max);
  return out;
}

export async function folderExists(folder) {
  if (!folder) return true; // root exists
  const segments = norm(folder).split('/').filter(Boolean);
  let current = '';
  for (const seg of segments) {
    try {
      const children = current ? await subFolders(current) : await rootFolders();
      if (!children.includes(seg)) return false;
      current = current ? `${current}/${seg}` : seg;
    } catch {
      return false;
    }
  }
  return true;
}

export async function createFolder(folder) {
  return cloudinary.api.create_folder(norm(folder));
}

export async function deleteAsset(publicId, { resource_type = 'image' } = {}) {
  return cloudinary.uploader.destroy(norm(publicId), { resource_type });
}

export async function uploadFile(localPath, publicId, { resource_type = 'image', overwrite = true } = {}) {
  const normId = norm(publicId);
  const parts = normId.split('/');
  parts.pop();
  const folder = parts.join('/');

  return cloudinary.uploader.upload(localPath, {
    public_id: normId,
    asset_folder: folder || undefined,
    use_asset_folder_as_public_id_prefix: false,
    resource_type,
    overwrite,
  });
}

// Recursively delete a folder and all contents
export async function deleteFolderRecursive(folder) {
  const full = norm(folder);
  // delete resources under prefix
  // delete resources under prefix for all standard resource types
  for (const resource_type of ['image', 'video', 'raw']) {
    try {
      await cloudinary.api.delete_resources_by_prefix(full + '/', { resource_type });
    } catch {}
  }
  // delete nested subfolders first
  const subs = await subFolders(full);
  for (const s of subs) {
    await deleteFolderRecursive(join(full, s));
  }
  // finally delete this folder (must be empty now)
  try { await cloudinary.api.delete_folder(full); } catch {}
}

// Build a tree structure: { name, files:[], dirs:[subtrees...] }
export async function buildTree(folder, { depth = Infinity, resource_type = 'image', maxFilesPerDir = 100 } = {}) {
  const here = norm(folder);
  const node = { name: here || '/', files: [], dirs: [] };
  node.files = await listFilesImmediate(here, { max: maxFilesPerDir, resource_type });
  if (depth <= 0) return node;
  const subs = here ? await subFolders(here) : await rootFolders();
  for (const s of subs) {
    const child = await buildTree(join(here, s), { depth: depth - 1, resource_type, maxFilesPerDir });
    node.dirs.push(child);
  }
  return node;
}
