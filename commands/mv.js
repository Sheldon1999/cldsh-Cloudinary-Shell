import { v2 as cloudinary } from 'cloudinary';

export default async function mv(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const sourceArg = args[0];
  const targetArg = args[1];

  if (!sourceArg || !targetArg) {
    return printer.println(printer.warn('Usage: mv <source> <target> [-o] [--rt=image|video|raw] [--dry-run]'));
  }

  const rtype = flags.rt || flags['resource-type'] || 'image';
  const overwrite = flags.o !== undefined ? !!flags.o : false;
  const isDryRun = Boolean(flags['dry-run'] || flags.dryRun);

  const fromPublicId = sourceArg.includes('/')
    ? utils.norm(sourceArg)
    : utils.join(ctx.cwd, sourceArg);

  let toPublicId;
  const baseName = fromPublicId.split('/').pop();

  if (targetArg.endsWith('/')) {
    // Explicit folder target: move into folder preserving basename
    const targetFolder = utils.resolvePath(ctx.cwd, targetArg);
    toPublicId = utils.join(targetFolder, baseName);
  } else {
    // Check if targetArg resolves to an existing folder
    const potentialFolder = utils.resolvePath(ctx.cwd, targetArg);
    const isFolder = await utils.folderExists(potentialFolder);
    if (isFolder && potentialFolder) {
      toPublicId = utils.join(potentialFolder, baseName);
    } else {
      toPublicId = targetArg.includes('/')
        ? utils.resolvePath(ctx.cwd, targetArg)
        : utils.join(ctx.cwd, targetArg);
    }
  }

  if (fromPublicId === toPublicId) {
    return printer.println(printer.warn(`Source and target are identical: ${fromPublicId}`));
  }

  if (isDryRun) {
    printer.println(printer.warn(`[DRY-RUN] Would rename: ${fromPublicId} -> ${toPublicId} (overwrite=${overwrite}, resource_type=${rtype})`));
    return;
  }

  printer.println(printer.dim(`Renaming ${fromPublicId} -> ${toPublicId} ...`));

  try {
    const res = await cloudinary.uploader.rename(fromPublicId, toPublicId, {
      resource_type: rtype,
      overwrite,
      invalidate: true,
    });

    printer.println(printer.ok(`Moved: ${fromPublicId} -> ${res.public_id || toPublicId}`));
    ctx.invalidateFolderCache?.();
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
