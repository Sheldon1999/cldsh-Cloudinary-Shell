import { planDelete, executeDelete, describePlan } from '../lib/actions/delete.js';
import { confirmDestructive } from '../lib/confirm.js';
import { isGlob } from '../lib/glob.js';
import { isWithin, parentOf } from '../lib/paths.js';
import { EXIT, usageError } from '../lib/errors.js';
import { RT_FLAG, TYPE_FLAG, DRY_RUN_FLAG, YES_FLAG, resourceTypesFrom } from '../lib/flags.js';

/** Plans with more assets than this ask for confirmation even without -r or wildcards. */
const BULK_THRESHOLD = 20;

export const spec = {
  name: 'rm',
  usage: "rm [-r|-rf] <name|folder|'pattern'>... [--rt=image|video|raw|all] [--type=upload] [--dry-run] [-y] [--skip-backup]",
  summary: 'Delete assets, or folders with -r (wildcards: quote them, e.g. \'cld*\')',
  flags: {
    recursive: { type: 'boolean', short: 'r', description: 'Delete folders with everything in them' },
    force: { type: 'boolean', short: 'f', description: 'Accepted for compatibility (as in rm -rf); use -y to skip the prompt' },
    ...RT_FLAG,
    ...TYPE_FLAG,
    ...DRY_RUN_FLAG,
    ...YES_FLAG,
    'skip-backup': { type: 'boolean', description: 'Delete folders even when they hold backed-up versions of deleted assets' },
  },
  notes: [
    'Recursive deletes, wildcard deletes and deletes of more than 20 assets show the plan and ask first; -y skips the question.',
    'Emptying the whole account (rm -r /) asks you to type the cloud name.',
    'Without a terminal (scripts, CI) those deletes need --yes.',
  ],
};

export default async function rm(ctx, args, flags) {
  if (!args.length) throw usageError('rm needs an asset, folder or pattern', spec.usage);
  const backend = await ctx.backend();
  const plan = await planDelete(backend, {
    cwd: ctx.cwd,
    targets: args,
    recursive: Boolean(flags.recursive),
    resourceTypes: resourceTypesFrom(flags),
    deliveryTypes: flags.type ? [flags.type] : undefined,
  });

  if (flags['dry-run']) {
    if (plan.missing.length) ctx.setExitCode(EXIT.PARTIAL);
    return { dry_run: true, plan };
  }

  const destructive = plan.assets.length > 0 || plan.folders.length > 0;
  const needsConfirm = plan.rootWide || plan.recursive || args.some(isGlob) || plan.assets.length > BULK_THRESHOLD;
  if (destructive && needsConfirm) {
    await confirmDestructive(ctx, {
      summaryLines: describePlan(plan, { limit: 10 }),
      needsTypedCloud: plan.rootWide,
      cloudName: plan.cloud,
    });
  }

  if (plan.assets.length > 100) ctx.out.progress(`Deleting ${plan.assets.length} assets…`);
  const result = await executeDelete(backend, plan, { skipBackup: Boolean(flags['skip-backup']) });
  const { summary } = result;
  if (summary.not_found || summary.failed || summary.folders_failed) ctx.setExitCode(EXIT.PARTIAL);

  // Leave a deleted folder the shell is standing in.
  const gone = result.folders.find(f => f.status === 'deleted' && isWithin(ctx.cwd, f.path));
  if (gone && ctx.session?.setCwd) {
    ctx.session.setCwd(parentOf(gone.path));
    ctx.out.info(`Current folder was deleted; now in /${parentOf(gone.path)}`);
  }

  return { cloud: plan.cloud, targets: plan.targets, recursive: plan.recursive, ...result };
}

export function render(result, ctx) {
  const { out } = ctx;
  if (result.dry_run) {
    out.print('[dry-run] Nothing was deleted. Plan:');
    for (const line of describePlan(result.plan, { limit: Infinity })) out.print(line);
    return;
  }
  for (const i of result.items) {
    const name = i.path || i.public_id;
    if (i.status === 'deleted') out.success(`deleted    ${name}`);
    else if (i.status === 'not_found') out.print(out.c.yellow(`not found  ${i.target ?? name}`));
    else out.print(out.c.red(`failed     ${name}: ${i.error}`));
  }
  for (const f of result.folders) {
    if (f.status === 'deleted') out.success(`deleted    ${f.path}/`);
    else {
      out.print(out.c.red(`failed     ${f.path}/: ${f.error}`));
      if (f.hint) out.warn(`  hint: ${f.hint}`);
    }
  }
  const s = result.summary;
  const folderPart = result.folders.length ? ` · folders deleted ${s.folders_deleted} · folders failed ${s.folders_failed}` : '';
  out.print(`Deleted ${s.deleted} · not found ${s.not_found} · failed ${s.failed}${folderPart}`);
}
