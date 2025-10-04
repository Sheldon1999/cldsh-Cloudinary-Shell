export default async function rm(ctx, args, _flags) {
  const { utils, printer } = ctx;
  const a0 = args[0];
  if (!a0) return printer.println(printer.warn('rm <name|public_id>  or  rm -rf <folder>'));

  if (a0 === '-rf') {
    const folder = args[1];
    if (!folder) return printer.println(printer.warn('rm -rf <folder>'));
    const full = utils.join(ctx.cwd, folder);
    try {
      await utils.deleteFolderRecursive(full);
      printer.println(printer.ok(`Removed folder: ${full}`));
    } catch (e) {
      printer.println(printer.error(e?.message || String(e)));
    }
    return;
  }

  // single asset
  const target = a0.includes('/') ? a0 : utils.join(ctx.cwd, a0);
  try {
    const res = await utils.deleteAsset(target);
    const status = res.result || 'unknown';
    if (status === 'ok' || status === 'not_found') printer.println(printer.ok(`Remove: ${target} → ${status}`));
    else printer.println(`Remove: ${target} → ${status}`);
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
