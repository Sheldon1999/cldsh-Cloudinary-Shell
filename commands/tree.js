import { actionTree } from '../lib/actions/tree.js';

export default async function tree(ctx, _args = [], flags = {}) {
  const { printer } = ctx;
  const depth = flags.d !== undefined ? Number(flags.d) : Infinity;
  const rtype = flags.rt || flags['resource-type'] || 'image';
  const maxFilesPerDir = flags.max !== undefined ? Number(flags.max) : 100;

  try {
    const node = await actionTree('', {
      cwd: ctx.cwd,
      depth,
      resourceType: rtype,
      maxFilesPerDir,
    });

    if (flags.json) {
      console.log(JSON.stringify(node, null, 2));
      return node;
    }

    printer.printTree(node);
    return node;
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
    if (flags.json) throw e;
  }
}
