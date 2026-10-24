import { actionDownload } from '../lib/actions/download.js';

export default async function download(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const targetArg = args[0];
  const destArg = args[1];

  if (!targetArg) {
    return printer.println(printer.warn('download <name|pattern> [local_path] [--rt=image] [--json]'));
  }

  const resourceType = flags.rt || flags['resource-type'] || 'image';

  try {
    if (!flags.json) {
      printer.println(printer.dim(`Downloading ${targetArg} ...`));
    }

    const result = await actionDownload(targetArg, {
      destination: destArg,
      cwd: ctx.cwd,
      resourceType,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    for (let i = 0; i < result.items.length; i++) {
      const item = result.items[i];
      if (item.status === 'downloaded') {
        const sizeStr = printer.formatBytes(item.bytes);
        if (result.isGlob) {
          printer.println(printer.ok(`[${i + 1}/${result.items.length}] Saved: ${item.localPath} (${sizeStr})`));
        } else {
          printer.println(printer.ok(`Saved: ${item.localPath} (${sizeStr})`));
        }
      } else {
        printer.println(printer.error(`Failed ${item.public_id}: ${item.error}`));
      }
    }

    return result;
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
    if (flags.json) throw e;
  }
}
