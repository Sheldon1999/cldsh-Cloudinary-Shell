import { isGlob, parseGlobTarget } from '../lib/glob.js';

export default async function rm(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const isRecursive = Boolean(
    (flags.r && flags.f) ||
    flags.rf ||
    flags.r ||
    args[0] === '-rf' ||
    args[0] === '-r'
  );

  const targetArg = (args[0] === '-rf' || args[0] === '-r') ? args[1] : args[0];

  if (!targetArg) {
    return printer.println(printer.warn('rm <name|pattern> [--rt=image] [--dry-run]  or  rm -rf <folder|pattern> [--dry-run]'));
  }

  const resourceType = flags.rt || flags['resource-type'] || 'image';
  const isDryRun = Boolean(flags['dry-run'] || flags.dryRun);

  // Wildcard pattern matching (e.g. rm cld* or rm *.png or rm -rf test*)
  if (isGlob(targetArg)) {
    const globInfo = parseGlobTarget(ctx.cwd, targetArg);
    const targetFolder = globInfo.folderPart ? utils.resolvePath(ctx.cwd, globInfo.folderPart) : utils.norm(ctx.cwd);

    try {
      if (isRecursive) {
        const subs = targetFolder ? await utils.subFolders(targetFolder) : await utils.rootFolders();
        const matchingFolders = subs.filter(s => globInfo.regex.test(s));
        const filesRaw = await utils.listFilesImmediate(targetFolder, { resource_type: resourceType, max: 500 });
        const matchingFiles = filesRaw.filter(r => {
          const name = r.public_id.split('/').pop();
          return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
        });

        if (!matchingFolders.length && !matchingFiles.length) {
          return printer.println(printer.warn(`No folders or assets found matching: ${targetArg}`));
        }

        if (isDryRun) {
          printer.println(printer.warn(`\n[DRY-RUN] Found matching items for "${targetArg}" in ${targetFolder || '/'}:`));
          for (const f of matchingFolders) {
            const full = utils.join(targetFolder, f);
            printer.println(`  [DRY-RUN] Would recursively remove folder: ${full}`);
          }
          for (const r of matchingFiles) {
            printer.println(`  [DRY-RUN] Would remove asset: ${r.public_id}`);
          }
          printer.println(printer.dim('\nNo assets or folders were deleted (dry-run mode).\n'));
          return;
        }

        for (const f of matchingFolders) {
          const full = utils.join(targetFolder, f);
          await utils.deleteFolderRecursive(full);
          printer.println(printer.ok(`Removed folder: ${full}`));
        }
        for (const r of matchingFiles) {
          await utils.deleteAsset(r.public_id, { resource_type: resourceType });
          printer.println(printer.ok(`Remove: ${r.public_id} → ok`));
        }
        ctx.invalidateFolderCache?.();
        return;
      }

      // Non-recursive: remove matching assets
      const filesRaw = await utils.listFilesImmediate(targetFolder, { resource_type: resourceType, max: 500 });
      const matchingFiles = filesRaw.filter(r => {
        const name = r.public_id.split('/').pop();
        return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
      });

      if (!matchingFiles.length) {
        return printer.println(printer.warn(`No assets found matching pattern: ${targetArg}`));
      }

      if (isDryRun) {
        printer.println(printer.warn(`\n[DRY-RUN] Found ${matchingFiles.length} asset(s) matching "${targetArg}":`));
        for (const r of matchingFiles) {
          printer.println(`  [DRY-RUN] Would remove asset: ${r.public_id}`);
        }
        printer.println(printer.dim('\nNo assets were deleted (dry-run mode).\n'));
        return;
      }

      for (const r of matchingFiles) {
        const res = await utils.deleteAsset(r.public_id, { resource_type: resourceType });
        const status = res.result || 'ok';
        printer.println(printer.ok(`Remove: ${r.public_id} → ${status}`));
      }
      printer.println(printer.ok(`\nDeleted ${matchingFiles.length} asset(s) matching "${targetArg}".`));
    } catch (e) {
      printer.println(printer.error(e?.message || String(e)));
    }
    return;
  }

  // Exact single folder recursive removal
  if (isRecursive) {
    const full = utils.join(ctx.cwd, targetArg);
    if (isDryRun) {
      printer.println(printer.warn(`[DRY-RUN] Would recursively remove folder and all contents: ${full}`));
      return;
    }
    try {
      await utils.deleteFolderRecursive(full);
      ctx.invalidateFolderCache?.();
      printer.println(printer.ok(`Removed folder: ${full}`));
    } catch (e) {
      printer.println(printer.error(e?.message || String(e)));
    }
    return;
  }

  // Exact single asset removal
  const target = targetArg.includes('/') ? targetArg : utils.join(ctx.cwd, targetArg);

  if (isDryRun) {
    printer.println(printer.warn(`[DRY-RUN] Would remove asset: ${target} (resource_type=${resourceType})`));
    return;
  }

  try {
    const res = await utils.deleteAsset(target, { resource_type: resourceType });
    const status = res.result || 'unknown';
    if (status === 'ok' || status === 'not_found') {
      printer.println(printer.ok(`Remove: ${target} → ${status}`));
    } else {
      printer.println(`Remove: ${target} → ${status}`);
    }
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
