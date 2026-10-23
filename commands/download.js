import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import { isGlob, parseGlobTarget } from '../lib/glob.js';

function resolveLocalPath(p = '') {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(process.cwd(), p);
}

async function downloadSingleAsset(publicId, downloadUrl, localDest, printer) {
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

export default async function download(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const targetArg = args[0];
  const destArg = args[1];

  if (!targetArg) {
    return printer.println(printer.warn('download <name|pattern> [local_path] [--rt=image]'));
  }

  const rtype = flags.rt || flags['resource-type'] || 'image';

  // Wildcard batch download (e.g. download cld* or download *.png)
  if (isGlob(targetArg)) {
    const globInfo = parseGlobTarget(ctx.cwd, targetArg);
    const targetFolder = globInfo.folderPart ? utils.resolvePath(ctx.cwd, globInfo.folderPart) : utils.norm(ctx.cwd);

    try {
      const filesRaw = await utils.listFilesImmediate(targetFolder, { resource_type: rtype, max: 500 });
      const matchingFiles = filesRaw.filter(r => {
        const name = r.public_id.split('/').pop();
        return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
      });

      if (!matchingFiles.length) {
        return printer.println(printer.warn(`No assets found matching pattern: ${targetArg}`));
      }

      const outDir = destArg ? resolveLocalPath(destArg) : process.cwd();
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      printer.println(printer.dim(`Downloading ${matchingFiles.length} asset(s) matching "${targetArg}" ...`));

      for (let i = 0; i < matchingFiles.length; i++) {
        const r = matchingFiles[i];
        const baseName = r.public_id.split('/').pop();
        const extension = r.format ? `.${r.format}` : '';
        const fileName = baseName.includes('.') ? baseName : `${baseName}${extension}`;
        const localDest = path.join(outDir, fileName);
        const downloadUrl = r.secure_url || r.url;

        try {
          const bytes = await downloadSingleAsset(r.public_id, downloadUrl, localDest, printer);
          printer.println(printer.ok(`[${i + 1}/${matchingFiles.length}] Saved: ${fileName} (${printer.formatBytes(bytes)})`));
        } catch (e) {
          printer.println(printer.error(`[${i + 1}/${matchingFiles.length}] Failed ${baseName}: ${e?.message || String(e)}`));
        }
      }
    } catch (e) {
      printer.println(printer.error(e?.message || String(e)));
    }
    return;
  }

  // Single asset download
  const publicId = targetArg.includes('/') ? targetArg : utils.join(ctx.cwd, targetArg);

  try {
    const asset = await cloudinary.api.resource(publicId, { resource_type: rtype });
    const downloadUrl = asset.secure_url || asset.url;
    if (!downloadUrl) {
      return printer.println(printer.error(`No downloadable URL found for: ${publicId}`));
    }

    const baseName = publicId.split('/').pop();
    const extension = asset.format ? `.${asset.format}` : '';
    const defaultFileName = baseName.includes('.') ? baseName : `${baseName}${extension}`;

    let localDest;
    if (destArg) {
      const resolved = resolveLocalPath(destArg);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        localDest = path.join(resolved, defaultFileName);
      } else {
        localDest = resolved;
      }
    } else {
      localDest = path.resolve(process.cwd(), defaultFileName);
    }

    printer.println(printer.dim(`Downloading ${publicId} ...`));
    const bytes = await downloadSingleAsset(publicId, downloadUrl, localDest, printer);
    const sizeStr = printer.formatBytes(bytes);
    printer.println(printer.ok(`Saved: ${localDest} (${sizeStr})`));
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
