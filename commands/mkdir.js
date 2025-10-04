export default async function mkdir(ctx, args) {
  const { utils, printer } = ctx;
  const name = args[0];
  if (!name) return printer.println(printer.warn('mkdir <name>'));
  const full = utils.join(ctx.cwd, name);
  try {
    await utils.createFolder(full);
    printer.println(printer.ok(`Created folder: ${full}`));
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
