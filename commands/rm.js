import { actionDelete } from '../lib/actions/delete.js';

export default async function rm(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const isRecursive = Boolean(
    (flags.r && flags.f) ||
    flags.rf ||
    flags.r ||
    args[0] === '-rf' ||
    args[0] === '-r'
  );

  const targetArg = (args[0] === '-rf' || args[0] === '-r') ? args[1] : args[0];

  if (!targetArg) {
    return printer.println(printer.warn('rm <name|pattern> [--rt=image] [--dry-run] [--json]  or  rm -rf <folder|pattern> [--dry-run]'));
  }

  const resourceType = flags.rt || flags['resource-type'] || 'image';
  const dryRun = Boolean(flags['dry-run'] || flags.dryRun);

  try {
    const result = await actionDelete(targetArg, {
      cwd: ctx.cwd,
      recursive: isRecursive,
      resourceType,
      dryRun,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    if (result.dryRun) {
      printer.println(printer.warn(`\n[DRY-RUN] Previewing deletion for "${targetArg}":`));
      for (const f of result.deletedFolders) {
        printer.println(`  [DRY-RUN] Would recursively remove folder: ${f}`);
      }
      for (const a of result.deletedAssets) {
        printer.println(`  [DRY-RUN] Would remove asset: ${a}`);
      }
      printer.println(printer.dim('\nNo assets or folders were deleted (dry-run mode).\n'));
      return result;
    }

    for (const f of result.deletedFolders) {
      printer.println(printer.ok(`Removed folder: ${f}`));
    }
    for (const a of result.deletedAssets) {
      printer.println(printer.ok(`Remove: ${a} → ok`));
    }

    if (result.isGlob) {
      printer.println(printer.ok(`\nDeleted ${result.total} item(s) matching "${targetArg}".`));
    }

    if (result.deletedFolders.length > 0) {
      ctx.invalidateFolderCache?.();
    }

    return result;
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
    if (flags.json) throw e;
  }
}
