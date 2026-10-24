import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import * as cld from '../cld.js';
import { isGlob, parseGlobTarget } from '../glob.js';

function resolveLocalPath(p = '') {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(process.cwd(), p);
}

async function streamDownload(downloadUrl, localDest) {
  const parentDir = path.dirname(localDest);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}: ${res.statusText}`);
  }

  const outStream = fs.createWriteStream(localDest);
  await pipeline(Readable.fromWeb(res.body), outStream);
  const stats = fs.statSync(localDest);
  return stats.size;
}

export async function actionDownload(targetArg = '', {
  destination = '',
  cwd = '',
  resourceType = 'image',
} = {}) {
  if (!targetArg) {
    throw new Error('download requires an asset name, path, or pattern.');
  }

  // Wildcard batch download
  if (isGlob(targetArg)) {
    const globInfo = parseGlobTarget(cwd, targetArg);
    const targetFolder = globInfo.folderPart ? cld.resolvePath(cwd, globInfo.folderPart) : cld.norm(cwd);

    const filesRaw = await cld.listFilesImmediate(targetFolder, { resource_type: resourceType, max: 500 });
    const matchingFiles = filesRaw.filter(r => {
      const name = r.public_id.split('/').pop();
      return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
    });

    if (!matchingFiles.length) {
      return { isGlob: true, items: [], total: 0 };
    }

    const outDir = destination ? resolveLocalPath(destination) : process.cwd();
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const items = [];
    for (const r of matchingFiles) {
      const baseName = r.public_id.split('/').pop();
      const extension = r.format ? `.${r.format}` : '';
      const fileName = baseName.includes('.') ? baseName : `${baseName}${extension}`;
      const localDest = path.join(outDir, fileName);
      const downloadUrl = r.secure_url || r.url;

      try {
        const bytes = await streamDownload(downloadUrl, localDest);
        items.push({ public_id: r.public_id, localPath: localDest, bytes, status: 'downloaded' });
      } catch (e) {
        items.push({ public_id: r.public_id, localPath: localDest, bytes: 0, status: 'failed', error: e?.message || String(e) });
      }
    }

    return { isGlob: true, items, total: items.length };
  }

  // Single asset download
  const publicId = targetArg.includes('/') ? targetArg : cld.join(cwd, targetArg);
  const asset = await cloudinary.api.resource(publicId, { resource_type: resourceType });
  const downloadUrl = asset.secure_url || asset.url;
  if (!downloadUrl) {
    throw new Error(`No downloadable URL found for: ${publicId}`);
  }

  const baseName = publicId.split('/').pop();
  const extension = asset.format ? `.${asset.format}` : '';
  const defaultFileName = baseName.includes('.') ? baseName : `${baseName}${extension}`;

  let localDest;
  if (destination) {
    const resolved = resolveLocalPath(destination);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      localDest = path.join(resolved, defaultFileName);
    } else {
      localDest = resolved;
    }
  } else {
    localDest = path.resolve(process.cwd(), defaultFileName);
  }

  const bytes = await streamDownload(downloadUrl, localDest);
  return {
    isGlob: false,
    items: [{ public_id: publicId, localPath: localDest, bytes, status: 'downloaded' }],
    total: 1,
  };
}
