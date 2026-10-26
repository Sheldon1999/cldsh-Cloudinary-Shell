import { resolveRemote } from '../lib/paths.js';
import { usageError } from '../lib/errors.js';

export const spec = {
  name: 'cd',
  usage: 'cd [folder|..|/|~|-]',
  summary: 'Change Cloudinary folder (.. up, / or ~ root, - previous)',
  flags: {},
};

export default async function cd(ctx, args) {
  const { session } = ctx;
  if (session.mode !== 'repl') throw usageError('cd only works inside the interactive shell', 'pass full paths to single commands instead');
  const target = args[0];
  if (target === '-') {
    session.setCwd(session.prevCwd || '');
    return { cwd: session.cwd, printed: true };
  }
  const next = resolveRemote(session.cwd, target || '/');
  if (next) {
    const backend = await ctx.backend();
    await backend.requireFolder(next, target);
  }
  session.setCwd(next);
  return { cwd: next };
}

export function render(result, ctx) {
  if (result.printed) ctx.out.print('/' + result.cwd);
}
