import { actionUrl } from '../lib/actions/url.js';
import { usageError, EXIT } from '../lib/errors.js';
import { isGlob } from '../lib/glob.js';
import { RT_FLAG, TYPE_FLAG, resourceTypeFrom } from '../lib/flags.js';

export const spec = {
  name: 'url',
  usage: 'url <name|public_id|pattern>... [--t="<transformation>"] [--signed] [--type=upload] [--rt=image|video|raw]',
  summary: 'Print delivery URLs, optionally transformed or signed',
  flags: {
    t: { type: 'string', placeholder: 'transformation', description: 'Transformation to apply, e.g. --t="w_300,c_fill"' },
    signed: {
      type: 'boolean',
      description: 'Sign the URL (needed for authenticated assets; private originals get a download URL)',
    },
    ...RT_FLAG,
    ...TYPE_FLAG,
  },
};

export default async function url(ctx, args, flags) {
  if (!args.length) throw usageError('url needs an asset name, path or pattern', spec.usage);
  const backend = await ctx.backend();
  const result = await actionUrl(backend, {
    cwd: ctx.cwd,
    targets: args,
    transformation: flags.t,
    signed: Boolean(flags.signed),
    deliveryType: flags.type,
    resourceType: resourceTypeFrom(flags),
  });
  if (result.failed?.length) ctx.setExitCode(EXIT.PARTIAL);
  if (!flags.signed && result.items.some(i => i.type === 'authenticated' || (i.type === 'private' && !flags.t))) {
    ctx.out.warn('Authenticated assets and private originals are only delivered through signed URLs; add --signed.');
  }
  return result;
}

export function render(result, ctx) {
  const single = result.items.length === 1 && !result.failed && !isGlob(result.items[0].target);
  for (const item of result.items) ctx.out.print(single ? item.url : `${item.public_id}: ${item.url}`);
  for (const f of result.failed || []) ctx.out.error(`${f.target}: ${f.message}`);
}
