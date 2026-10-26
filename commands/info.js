import { actionInfo } from '../lib/actions/info.js';
import { formatInfo } from '../lib/printer.js';
import { usageError } from '../lib/errors.js';
import { RT_FLAG, TYPE_FLAG, resourceTypeFrom } from '../lib/flags.js';

export const spec = {
  name: 'info',
  usage: 'info <name|public_id|asset_id:ID> [--rt=image|video|raw] [--type=upload] [-v]',
  summary: 'Inspect asset metadata (dimensions, size, tags)',
  flags: {
    verbose: { type: 'boolean', short: 'v', description: 'Print the full API response' },
    ...RT_FLAG,
    ...TYPE_FLAG,
  },
};

export default async function info(ctx, args, flags) {
  if (!args[0]) throw usageError('info needs an asset name', spec.usage);
  const backend = await ctx.backend();
  return actionInfo(backend, { cwd: ctx.cwd, target: args[0], resourceType: resourceTypeFrom(flags), deliveryType: flags.type });
}

export function render(result, ctx) {
  if (ctx.flags.verbose) ctx.out.print(JSON.stringify(result, null, 2));
  else ctx.out.print(formatInfo(result, ctx.out.c));
}
