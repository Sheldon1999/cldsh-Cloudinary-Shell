import { resolveRemote } from '../lib/paths.js';
import { usageError } from '../lib/errors.js';

export const spec = {
  name: 'mkdir',
  usage: 'mkdir <folder>...',
  summary: 'Create folders (missing parents are created too)',
  flags: {},
};

export default async function mkdir(ctx, args) {
  if (!args.length) throw usageError('mkdir needs a folder name', spec.usage);
  const backend = await ctx.backend();
  const created = [];
  for (const a of args) {
    const path = resolveRemote(ctx.cwd, a);
    if (!path) throw usageError('The root folder already exists');
    created.push((await backend.createFolder(path)).path);
  }
  return { created };
}

export function render(result, ctx) {
  for (const p of result.created) ctx.out.success(`Created folder: ${p}`);
}
