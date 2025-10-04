import { v2 as cloudinary } from 'cloudinary';

export const norm = (p = '') => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
export const join = (a, b) => norm([norm(a), norm(b)].filter(Boolean).join('/'));

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
  const parent = norm(folder.split('/').slice(0, -1).join('/'));
  const name = folder.split('/').pop();
  const children = parent ? await subFolders(parent) : await rootFolders();
  return children.includes(name);
}

export async function createFolder(folder) {
  return cloudinary.api.create_folder(norm(folder));
}

export async function deleteAsset(publicId, { resource_type = 'image' } = {}) {
  return cloudinary.uploader.destroy(norm(publicId), { resource_type });
}

export async function uploadFile(localPath, publicId, { resource_type = 'image', overwrite = true } = {}) {
  return cloudinary.uploader.upload(localPath, {
    public_id: norm(publicId),
    resource_type,
    overwrite,
  });
}

// Recursively delete a folder and all contents
export async function deleteFolderRecursive(folder) {
  const full = norm(folder);
  // delete resources under prefix
  await cloudinary.api.delete_resources_by_prefix(full + '/');
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
