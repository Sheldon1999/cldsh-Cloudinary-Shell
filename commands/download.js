import fs from 'node:fs';
import { planDownload, executeDownload } from '../lib/actions/download.js';
import { MAX_CONCURRENCY, DEFAULT_CONCURRENCY } from '../lib/actions/upload.js';
import { formatBytes } from '../lib/printer.js';
import { resolveLocal } from '../lib/paths.js';
import { usageError, EXIT } from '../lib/errors.js';
import { RT_FLAG, TYPE_FLAG, resourceTypeFrom } from '../lib/flags.js';

export const spec = {
  name: 'download',
  usage: 'download <name|pattern>... [destination] [-f] [--rt=image|video|raw] [--type=upload|private|authenticated] [--concurrency N]',
  summary: 'Download assets to the local disk (wildcards: cld*, *.png)',
  flags: {
    force: { type: 'boolean', short: 'f', description: 'Overwrite existing local files (default: skip them)' },
    ...RT_FLAG,
    ...TYPE_FLAG,
    concurrency: { type: 'number', placeholder: 'N', description: `Parallel downloads, 1-${MAX_CONCURRENCY} (default ${DEFAULT_CONCURRENCY})` },
  },
  notes: [
    'Destination: with two arguments the second one is the destination (download hero ./hero.png, download "cld*" ./out).',
    'With three or more arguments the last one is the destination only if it is an existing local directory or ends with "/"; otherwise every argument is an asset and files go to the local working directory.',
    'A single asset may be saved under a new file name; wildcards and several assets go into a directory, which is created when missing.',
    'Existing local files are skipped unless -f/--force is given. Private and authenticated assets download through signed URLs.',
  ],
};

const isLocalDir = (p) => {
  try {
    return fs.statSync(resolveLocal(p)).isDirectory();
  } catch {
    return false;
  }
};

/** Split arguments into targets and an optional destination (see spec.notes). */
export function splitDownloadArgs(args) {
  if (args.length === 2) return { targets: [args[0]], destination: args[1] };
  if (args.length > 2) {
    const last = args[args.length - 1];
    if (/[\\/]$/.test(last) || isLocalDir(last)) return { targets: args.slice(0, -1), destination: last };
  }
  return { targets: args, destination: undefined };
}

export default async function download(ctx, args, flags) {
  if (!args.length) throw usageError('download needs an asset name or pattern', spec.usage);
  if (flags.concurrency !== undefined && !(flags.concurrency >= 1)) throw usageError('--concurrency must be at least 1');
  const { targets, destination } = splitDownloadArgs(args);

  const backend = await ctx.backend();
  const plan = await planDownload(backend, {
    cwd: ctx.cwd,
    targets,
    destination,
    resourceType: resourceTypeFrom(flags),
    deliveryType: flags.type,
  });
  const many = plan.total > 1;
  const result = await executeDownload(plan, {
    overwrite: Boolean(flags.force),
    concurrency: flags.concurrency,
    onProgress(done, total, item) {
      if (!many) return;
      const detail = item.status === 'downloaded' ? ` (${formatBytes(item.bytes)})` : item.status === 'failed' ? `: ${item.error}` : ' (exists)';
      ctx.out.progress(`[${done}/${total}] ${item.status} ${item.localPath}${detail}`);
    },
  });

  const { failed, total } = result.summary;
  if (failed) ctx.setExitCode(failed === total ? EXIT.ERROR : EXIT.PARTIAL);
  return result;
}

export function render(result, ctx) {
  const { out } = ctx;
  const s = result.summary;
  if (s.total === 1) {
    const it = result.items[0];
    if (it.status === 'downloaded') out.success(`Saved: ${it.localPath} (${formatBytes(it.bytes)})`);
    else if (it.status === 'skipped') out.print(`Skipped (file exists, use -f to overwrite): ${it.localPath}`);
    else out.error(`Failed ${it.public_id || it.target}: ${it.error}`);
    return;
  }
  const line = `Downloaded ${s.downloaded} of ${s.total} (${formatBytes(s.bytes)}) to ${result.destination}: ${s.skipped} skipped · ${s.failed} failed`;
  if (s.failed) out.print(out.c.yellow(line));
  else out.success(line);
  if (s.skipped) out.info('Existing files were skipped; use -f to overwrite them.');
  for (const it of result.items.filter(i => i.status === 'failed')) out.error(`  failed ${it.public_id || it.target}: ${it.error}`);
}
