export default async function cd(ctx, args) {
  const { utils, printer } = ctx;
  const target = args[0];
  if (!target) return;
  if (target === '/') return ctx.setCwd('');
  if (target === '..') {
    const parts = utils.norm(ctx.cwd).split('/');
    parts.pop();
    return ctx.setCwd(parts.filter(Boolean).join('/'));
  }
  if (target === '-') return ctx.setCwd(ctx.prevCwd || '');

  const next = utils.join(ctx.cwd, target);
  const exists = await utils.folderExists(next);
  if (!exists) return printer.println(printer.warn(`No such folder: ${target}`));
  ctx.setCwd(next);
}
