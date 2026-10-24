import { actionList } from '../lib/actions/list.js';

export default async function ls(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const target = args[0];
  const resourceType = flags.rt || flags['resource-type'] || 'image';
  const max = flags.max !== undefined ? Number(flags.max) : 200;

  try {
    const result = await actionList(target, {
      cwd: ctx.cwd,
      resourceType,
      max,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    printer.printList({
      folders: result.folders,
      files: result.files,
      long: !!flags.l,
    });
    return result;
  } catch (e) {
    printer.println(printer.warn(e?.message || String(e)));
    if (flags.json) {
      throw e;
    }
  }
}
