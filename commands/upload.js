import { actionUpload } from '../lib/actions/upload.js';
export { planUploadPublicIds, collectDirectoryFiles } from '../lib/actions/upload.js';

export default async function upload(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const rawPath = args[0];
  const customName = args[1];

  if (!rawPath) {
    return printer.println(printer.warn('upload <local_path_or_dir> [name] [-r] [-o] [--rt=image] [--dry-run] [--json] [-v]'));
  }

  const resourceType = flags.rt || flags['resource-type'] || 'image';
  const overwrite = flags.o !== undefined ? !!flags.o : true;
  const recursive = Boolean(flags.r || flags.recursive);
  const dryRun = Boolean(flags['dry-run'] || flags.dryRun);
  const concurrency = Math.max(1, Math.min(10, Number(flags.concurrency) || 4));

  try {
    if (flags.json) {
      const result = await actionUpload(rawPath, {
        name: customName,
        cwd: ctx.cwd,
        recursive,
        overwrite,
        resourceType,
        concurrency,
        dryRun,
      });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    let progressStarted = false;
    const result = await actionUpload(rawPath, {
      name: customName,
      cwd: ctx.cwd,
      recursive,
      overwrite,
      resourceType,
      concurrency,
      dryRun,
      onProgress(completed, total, item) {
        if (!progressStarted && result?.isDirectory) {
          progressStarted = true;
        }
        if (item.status === 'uploaded') {
          printer.println(printer.ok(`[${completed}/${total}] Uploaded: ${item.url || item.publicId}`));
          if (flags.v && item.res) {
            console.log(JSON.stringify(item.res, null, 2));
          }
        } else {
          printer.println(printer.error(`[${completed}/${total}] Failed ${item.relPath}: ${item.error}`));
        }
      },
    });

    if (result.dryRun) {
      printer.println(printer.warn(`\n[DRY-RUN] Found ${result.items.length} item(s) to upload:`));
      for (let i = 0; i < result.items.length; i++) {
        const item = result.items[i];
        const collisionTag = item.hasCollision ? ' (collision resolved with _ext)' : '';
        printer.println(`  [${i + 1}/${result.items.length}] Would upload: ${item.relPath} -> ${item.publicId}${collisionTag}`);
      }
      printer.println(printer.dim('\nNo assets were uploaded (dry-run mode).\n'));
      return result;
    }

    if (!result.isDirectory && result.items.length === 1) {
      const item = result.items[0];
      if (item.status === 'uploaded') {
        const out = item.url
          ? `Uploaded: ${item.url}`
          : `Uploaded: (no URL in response)\npublic_id=${item.publicId}`;
        console.log(out);
        if (flags.v && item.res) {
          console.log('\nRAW RESPONSE:\n' + JSON.stringify(item.res, null, 2));
        }
      }
    } else if (result.isDirectory) {
      const succeeded = result.items.filter(i => i.status === 'uploaded').length;
      printer.println(printer.ok(`\nFinished uploading ${succeeded}/${result.items.length} file(s).\n`));
      ctx.invalidateFolderCache?.();
    }

    return result;
  } catch (e) {
    if (flags.json) throw e;
    printer.println(printer.error(e?.message || String(e)));
  }
}
