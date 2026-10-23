export default async function cd(ctx, args = []) {
  const { utils, printer } = ctx;
  const target = args[0];

  // cd with no args or cd ~ or cd / goes to root
  if (!target || target === '~' || target === '/') {
    return ctx.setCwd('');
  }

  // cd - toggles to previous directory
  if (target === '-') {
    const prev = ctx.prevCwd || '';
    ctx.setCwd(prev);
    printer.println('/' + (prev || ''));
    return;
  }

  const next = utils.resolvePath(ctx.cwd, target);
  const exists = await utils.folderExists(next);
  if (!exists) {
    return printer.println(printer.warn(`No such folder: ${target}`));
  }
  ctx.setCwd(next);
}
