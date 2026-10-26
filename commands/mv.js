import { planMove, executeMove } from '../lib/actions/move.js';
import { usageError } from '../lib/errors.js';
import { RT_FLAG, TYPE_FLAG, DRY_RUN_FLAG, resourceTypeFrom } from '../lib/flags.js';

export const spec = {
  name: 'mv',
  usage: 'mv <source> <target> [-o|--overwrite] [--public-id] [--rt=image|video|raw] [--type=upload] [--dry-run]',
  summary: 'Move or rename an asset or folder',
  flags: {
    overwrite: {
      type: 'boolean',
      short: 'o',
      description: 'Move even if the target exists (default: refuse); see the notes for what happens to it',
    },
    'public-id': {
      type: 'boolean',
      alias: ['publicId'],
      description: 'Dynamic folder mode: also rename the public ID (the delivery URL changes)',
    },
    ...RT_FLAG,
    ...TYPE_FLAG,
    ...DRY_RUN_FLAG,
  },
  notes: [
    'A target ending in "/" or naming an existing folder moves the source into that folder, keeping its name.',
    'Dynamic folder mode: moving and renaming keep the delivery URL (the asset folder and display name change);\n'
      + '--public-id renames the public ID as well, which changes the URL. Folders can be moved and renamed.',
    'Fixed folder mode: the folder is part of the public ID, so moving or renaming changes the URL.\n'
      + 'Cloudinary cannot move folders in this mode.',
    'With -o, an existing asset with the same public ID (same URL) is replaced. In dynamic folder mode without\n'
      + '--public-id, an asset that merely has the same name in the target folder is kept: the folder then has two\n'
      + 'assets with that name.',
  ],
};

export default async function mv(ctx, args, flags) {
  if (args.length !== 2) throw usageError('mv needs exactly one source and one target', spec.usage);
  const backend = await ctx.backend();
  const plan = await planMove(backend, {
    cwd: ctx.cwd,
    source: args[0],
    target: args[1],
    changePublicId: Boolean(flags['public-id']),
    overwrite: Boolean(flags.overwrite),
    resourceType: resourceTypeFrom(flags),
    deliveryType: flags.type,
  });
  if (flags['dry-run']) {
    const { ref, ...rest } = plan;
    return { dryRun: true, ...rest };
  }
  return { dryRun: false, ...(await executeMove(backend, plan)) };
}

export function render(result, ctx) {
  const what = result.kind === 'folder' ? 'folder ' : '';
  if (result.dryRun) {
    ctx.out.print(`Would move ${what}/${result.from} -> /${result.to} (${result.urlChanged ? 'URL changes' : 'URL unchanged'})`);
    if (result.kind === 'asset' && result.urlChanged) {
      ctx.out.print(`  public ID: ${result.public_id.from} -> ${result.public_id.to}`);
    }
    if (result.replaces?.length) ctx.out.print(`  replaces the existing asset with public ID ${result.public_id.to}`);
    if (result.sameName?.length) ctx.out.print(`  /${result.to} already exists; both assets will be kept under that name`);
    return;
  }
  ctx.out.success(`Moved: ${what}/${result.from} -> /${result.to} (${result.urlChanged ? 'URL changed' : 'URL unchanged'})`);
  if (result.kind === 'asset' && result.urlChanged) ctx.out.print(`  public ID: ${result.public_id.from} -> ${result.public_id.to}`);
  if (result.replaced?.length) ctx.out.warn(`Replaced: ${result.replaced.join(', ')}`);
  if (result.warning) ctx.out.warn(result.warning);
}
