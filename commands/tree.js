export default async function tree(ctx, _args, flags) {
  const { utils, printer } = ctx;
  const depth = flags.d !== undefined ? Number(flags.d) : Infinity;
  const rtype = flags.rt || 'image';
  const maxFilesPerDir = flags.max !== undefined ? Number(flags.max) : 100;
  try {
    const node = await utils.buildTree(ctx.cwd, { depth, resource_type: rtype, maxFilesPerDir });
    printer.printTree(node);
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
