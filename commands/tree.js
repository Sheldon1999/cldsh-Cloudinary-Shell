import { actionTree } from '../lib/actions/tree.js';
import { formatTree } from '../lib/printer.js';
import { RT_FLAG, resourceTypesFrom } from '../lib/flags.js';

export const spec = {
  name: 'tree',
  usage: 'tree [folder] [-d N] [--rt=image|video|raw|all] [--max N]',
  summary: 'Show the folder tree',
  flags: {
    depth: { type: 'number', short: 'd', placeholder: 'N', description: 'Maximum depth (default: unlimited)' },
    max: { type: 'number', placeholder: 'N', description: 'Maximum assets shown per folder (default 100)' },
    ...RT_FLAG,
  },
};

export default async function tree(ctx, args, flags) {
  const backend = await ctx.backend();
  return actionTree(backend, {
    cwd: ctx.cwd,
    target: args[0] || '',
    depth: flags.depth ?? Infinity,
    resourceTypes: resourceTypesFrom(flags),
    maxFilesPerDir: flags.max ?? 100,
  });
}

export function render(result, ctx) {
  ctx.out.print(formatTree(result, ctx.out.c));
}
