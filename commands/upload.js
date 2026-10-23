import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveLocal(p) {
  if (!p) return '';
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(process.cwd(), p);
}

// Recursively or shallowly collect all non-hidden files from a directory
export function collectDirectoryFiles(dirPath, recursive = false) {
  const results = [];
  function walk(currentDir, relPrefix) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // ignore hidden files like .DS_Store, .git
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

// Plan public IDs with collision detection (same basename, different extension)
export function planUploadPublicIds(files, targetCwd, utils) {
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

    // If collision exists in same folder, append _ext to prevent overwriting
    const name = hasCollision && ext ? `${parsed.name}_${ext}` : parsed.name;
    const targetFolder = dir ? utils.join(targetCwd, dir) : targetCwd;
    const publicId = utils.join(targetFolder, name);
    return {
      filePath: f.fullPath,
      relPath: f.relPath,
      publicId,
      hasCollision,
    };
  });
}

// Concurrency pool runner
async function runConcurrentPool(items, concurrency, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export default async function upload(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;

  const rawPath = args[0];
  if (!rawPath) {
    return printer.println(printer.warn('upload <local_path_or_dir> [name] [-r] [-o] [--rt=image] [--dry-run] [-v]'));
  }

  const localPath = resolveLocal(rawPath);
  if (!fs.existsSync(localPath)) {
    return printer.println(printer.error('File not found: ' + localPath));
  }

  const rtype = flags.rt || flags['resource-type'] || 'image';
  const overwrite = flags.o !== undefined ? !!flags.o : true;
  const isRecursive = Boolean(flags.r || flags.recursive);
  const isDryRun = Boolean(flags['dry-run'] || flags.dryRun);
  const concurrency = Math.max(1, Math.min(10, Number(flags.concurrency) || 4));

  const stat = fs.statSync(localPath);

  // Directory / Batch upload
  if (stat.isDirectory()) {
    const rawFiles = collectDirectoryFiles(localPath, isRecursive);
    if (rawFiles.length === 0) {
      return printer.println(printer.warn(`No files found in directory: ${localPath}`));
    }

    const planned = planUploadPublicIds(rawFiles, ctx.cwd, utils);

    if (isDryRun) {
      printer.println(printer.warn(`\n[DRY-RUN] Found ${planned.length} file(s) in ${localPath} (${isRecursive ? 'recursive' : 'flat'}):`));
      for (let i = 0; i < planned.length; i++) {
        const item = planned[i];
        const collisionTag = item.hasCollision ? ' (collision resolved with _ext)' : '';
        printer.println(`  [${i + 1}/${planned.length}] Would upload: ${item.relPath} -> ${item.publicId}${collisionTag}`);
      }
      printer.println(printer.dim('\nNo assets were uploaded (dry-run mode).\n'));
      return;
    }

    printer.println(printer.dim(`\nUploading ${planned.length} file(s) with concurrency=${concurrency} (${isRecursive ? 'recursive' : 'flat'}) ...`));

    // Ensure all target folders are registered in Cloudinary's Folder API so ls and tree discover them
    const folderSet = new Set();
    for (const item of planned) {
      const parts = item.publicId.split('/');
      parts.pop();
      if (parts.length > 0) {
        let acc = '';
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          folderSet.add(acc);
        }
      }
    }
    for (const f of folderSet) {
      try {
        await utils.createFolder(f);
      } catch {}
    }

    let completed = 0;
    await runConcurrentPool(planned, concurrency, async (item) => {
      try {
        const res = await utils.uploadFile(item.filePath, item.publicId, { resource_type: rtype, overwrite });
        completed++;
        const url = res?.secure_url || res?.url;
        printer.println(printer.ok(`[${completed}/${planned.length}] Uploaded: ${url || item.publicId}`));
        if (flags.v) {
          console.log(JSON.stringify(res, null, 2));
        }
      } catch (e) {
        completed++;
        printer.println(printer.error(`[${completed}/${planned.length}] Failed ${item.relPath}: ${e?.message || String(e)}`));
      }
    });

    printer.println(printer.ok(`\nFinished uploading ${completed}/${planned.length} file(s).\n`));
    ctx.invalidateFolderCache?.();
    return;
  }

  // Single file upload
  const customName = args[1];
  const defaultName = path.parse(localPath).name; // basename without extension
  const name = customName || defaultName;
  const publicId = utils.join(ctx.cwd, name);

  if (isDryRun) {
    printer.println(printer.warn(`[DRY-RUN] Would upload: ${localPath} -> ${publicId} (overwrite=${overwrite}, resource_type=${rtype})`));
    return;
  }

  try {
    const res = await utils.uploadFile(localPath, publicId, { resource_type: rtype, overwrite });
    const url = res?.secure_url || res?.url || null;
    const out = url
      ? `Uploaded: ${url}`
      : `Uploaded: (no URL in response)\npublic_id=${res?.public_id || publicId}`;

    console.log(out);

    if (flags.v) {
      console.log('\nRAW RESPONSE:\n' + JSON.stringify(res, null, 2));
    }
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
