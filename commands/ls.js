import { actionList } from '../lib/actions/list.js';
import { formatList } from '../lib/printer.js';
import { RT_FLAG, TYPE_FLAG, MAX_FLAG, resourceTypesFrom } from '../lib/flags.js';

export const spec = {
  name: 'ls',
  usage: 'ls [path|pattern] [-l] [--rt=image|video|raw|all] [--type=upload] [--max N]',
  summary: 'List folders and assets (wildcards: cld*, *.png)',
  flags: {
    long: { type: 'boolean', short: 'l', description: 'Long listing: size, dimensions, format, type' },
    ...RT_FLAG,
    ...TYPE_FLAG,
    ...MAX_FLAG,
  },
};

export default async function ls(ctx, args, flags) {
  const backend = await ctx.backend();
  return actionList(backend, {
    cwd: ctx.cwd,
    target: args[0] || '',
    resourceTypes: resourceTypesFrom(flags),
    deliveryTypes: [flags.type || 'upload'],
    max: flags.max ?? Infinity,
  });
}

export function render(result, ctx) {
  ctx.out.print(formatList({ folders: result.folders, files: result.files, long: ctx.flags.long }, ctx.out.c));
  if (result.truncated) ctx.out.warn(`Showing the first ${result.files.length} assets; raise --max to see more.`);
}
