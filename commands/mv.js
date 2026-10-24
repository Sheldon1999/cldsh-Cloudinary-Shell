import { actionMove } from '../lib/actions/move.js';

export default async function mv(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const sourceArg = args[0];
  const targetArg = args[1];

  if (!sourceArg || !targetArg) {
    return printer.println(printer.warn('Usage: mv <source> <target> [-o] [--rt=image|video|raw] [--dry-run] [--json]'));
  }

  const resourceType = flags.rt || flags['resource-type'] || 'image';
  const overwrite = flags.o !== undefined ? !!flags.o : false;
  const dryRun = Boolean(flags['dry-run'] || flags.dryRun);

  try {
    const result = await actionMove(sourceArg, targetArg, {
      cwd: ctx.cwd,
      resourceType,
      overwrite,
      dryRun,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    if (result.dryRun) {
      printer.println(printer.warn(`[DRY-RUN] Would rename: ${result.from} -> ${result.to} (overwrite=${overwrite}, resource_type=${resourceType})`));
      return result;
    }

    printer.println(printer.ok(`Moved: ${result.from} -> ${result.to}`));
    ctx.invalidateFolderCache?.();
    return result;
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
    if (flags.json) throw e;
  }
}
