import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cld from '../cld.js';

function resolveLocal(p) {
  if (!p) return '';
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(process.cwd(), p);
}

export function collectDirectoryFiles(dirPath, recursive = false) {
  const results = [];
  function walk(currentDir, relPrefix) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(currentDir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (recursive) {
          walk(full, rel);
        }
      } else if (e.isFile()) {
        results.push({ fullPath: full, relPath: rel });
      }
    }
  }
  walk(dirPath, '');
  return results;
}

export function planUploadPublicIds(files, targetCwd) {
  const counts = new Map();
  for (const f of files) {
    const dir = path.dirname(f.relPath) === '.' ? '' : path.dirname(f.relPath);
    const parsed = path.parse(f.relPath);
    const key = `${dir}:::${parsed.name.toLowerCase()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return files.map(f => {
    const dir = path.dirname(f.relPath) === '.' ? '' : path.dirname(f.relPath);
    const parsed = path.parse(f.relPath);
    const key = `${dir}:::${parsed.name.toLowerCase()}`;
    const hasCollision = (counts.get(key) || 0) > 1;
    const ext = parsed.ext ? parsed.ext.replace(/^\./, '').toLowerCase() : '';

    const name = hasCollision && ext ? `${parsed.name}_${ext}` : parsed.name;
    const targetFolder = dir ? cld.join(targetCwd, dir) : targetCwd;
    const publicId = cld.join(targetFolder, name);
    return {
      filePath: f.fullPath,
      relPath: f.relPath,
      publicId,
      hasCollision,
    };
  });
}

async function runConcurrentPool(items, concurrency, fn) {
  let index = 0;
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function actionUpload(rawPath, {
  name = null,
  cwd = '',
  recursive = false,
  overwrite = true,
  resourceType = 'image',
  concurrency = 4,
  dryRun = false,
  onProgress = null,
} = {}) {
  if (!rawPath) {
    throw new Error('Upload requires a local file or directory path.');
  }

  const localPath = resolveLocal(rawPath);
  if (!fs.existsSync(localPath)) {
    throw new Error(`File or directory not found: ${localPath}`);
  }

  const stat = fs.statSync(localPath);

  // Directory / Batch upload
  if (stat.isDirectory()) {
    const rawFiles = collectDirectoryFiles(localPath, recursive);
    if (rawFiles.length === 0) {
      return { isDirectory: true, items: [], total: 0 };
    }

    const planned = planUploadPublicIds(rawFiles, cwd);

    if (dryRun) {
      const items = planned.map(item => ({
        filePath: item.filePath,
        relPath: item.relPath,
        publicId: item.publicId,
        hasCollision: item.hasCollision,
        status: 'dry_run',
        url: null,
      }));
      return { isDirectory: true, items, total: items.length, dryRun: true };
    }

    let completed = 0;
    const items = await runConcurrentPool(planned, concurrency, async (item) => {
      try {
        const res = await cld.uploadFile(item.filePath, item.publicId, { resource_type: resourceType, overwrite });
        completed++;
        const url = res?.secure_url || res?.url || null;
        const result = {
          filePath: item.filePath,
          relPath: item.relPath,
          publicId: item.publicId,
          url,
          status: 'uploaded',
          res,
        };
        onProgress?.(completed, planned.length, result);
        return result;
      } catch (e) {
        completed++;
        const result = {
          filePath: item.filePath,
          relPath: item.relPath,
          publicId: item.publicId,
          url: null,
          status: 'failed',
          error: e?.message || String(e),
        };
        onProgress?.(completed, planned.length, result);
        return result;
      }
    });

    return { isDirectory: true, items, total: items.length, dryRun: false };
  }

  // Single file upload
  const defaultName = path.parse(localPath).name;
  const finalName = name || defaultName;
  const publicId = cld.join(cwd, finalName);

  if (dryRun) {
    return {
      isDirectory: false,
      items: [{
        filePath: localPath,
        relPath: path.basename(localPath),
        publicId,
        hasCollision: false,
        status: 'dry_run',
        url: null,
      }],
      total: 1,
      dryRun: true,
    };
  }

  const res = await cld.uploadFile(localPath, publicId, { resource_type: resourceType, overwrite });
  const url = res?.secure_url || res?.url || null;

  return {
    isDirectory: false,
    items: [{
      filePath: localPath,
      relPath: path.basename(localPath),
      publicId,
      url,
      status: 'uploaded',
      res,
    }],
    total: 1,
    dryRun: false,
  };
}
