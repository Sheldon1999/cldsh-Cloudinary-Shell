import { planUpload, executeUpload, MAX_CONCURRENCY, DEFAULT_CONCURRENCY } from '../lib/actions/upload.js';
import { formatBytes } from '../lib/printer.js';
import { CldshError, CODES, usageError, EXIT } from '../lib/errors.js';
import { DRY_RUN_FLAG } from '../lib/flags.js';

export const spec = {
  name: 'upload',
  usage: 'upload <local_path> [name] [--to folder] [-r] [--no-overwrite] [--rt=image|video|raw] [--concurrency N] [--dry-run] [-v]',
  summary: 'Upload a file, or the files of a directory (-r: with subfolders)',
  flags: {
    to: { type: 'string', alias: ['folder'], placeholder: 'folder', description: 'Remote folder to upload into (default: current folder)' },
    recursive: { type: 'boolean', short: 'r', description: 'Include subdirectories (mirrored as subfolders)' },
    overwrite: { type: 'boolean', short: 'o', description: 'Replace assets with the same public ID (default; --no-overwrite keeps them)' },
    rt: {
      type: 'string',
      alias: ['resource-type'],
      values: ['auto', 'image', 'video', 'raw'],
      placeholder: 'image|video|raw',
      description: 'Upload as this resource type (default: by file extension)',
    },
    concurrency: { type: 'number', placeholder: 'N', description: `Parallel uploads, 1-${MAX_CONCURRENCY} (default ${DEFAULT_CONCURRENCY})` },
    ...DRY_RUN_FLAG,
    verbose: { type: 'boolean', short: 'v', description: 'Include the full upload response' },
  },
  notes: [
    'Resource types come from the file extension: images (also PDF and SVG) -> image, video and audio -> video, anything else -> raw. --rt overrides.',
    'Image and video public IDs drop the extension; raw files keep it (notes.txt -> notes.txt). When two files in one folder would get the same public ID, both get their extension as suffix (photo_jpg, photo_png).',
    'Existing assets are overwritten by default and reported as "overwritten"; with --no-overwrite they are kept and reported as "skipped". Files over 20 MB are uploaded in 20 MB chunks with progress on stderr; transient failures are retried up to 3 times.',
    'Directory uploads skip dotfiles. --dry-run works without credentials.',
  ],
};

export default async function upload(ctx, args, flags) {
  if (!args[0]) throw usageError('upload needs a local file or directory', spec.usage);
  if (args.length > 2) throw usageError('upload takes one local path and an optional name', 'use --to <folder> for the target folder; quote names that contain spaces');
  if (flags.concurrency !== undefined && !(flags.concurrency >= 1)) throw usageError('--concurrency must be at least 1');

  const plan = planUpload({
    cwd: ctx.cwd,
    localPath: args[0],
    name: args[1],
    folder: flags.to,
    recursive: Boolean(flags.recursive),
    resourceType: flags.rt,
  });
  if (flags['dry-run']) return { ...plan, dryRun: true };

  const backend = await ctx.backend();
  const many = plan.isDirectory;
  let finished = 0;
  const result = await executeUpload(backend, plan, {
    overwrite: flags.overwrite !== false,
    concurrency: flags.concurrency,
    includeResponse: Boolean(flags.verbose),
    onChunk(item, sent, bytes) {
      const pct = Math.floor((sent / bytes) * 100);
      const prefix = many ? `[${finished}/${plan.total}] ` : '';
      ctx.out.progress(`${prefix}uploading ${item.relPath} ${pct}% (${formatBytes(sent)} of ${formatBytes(bytes)})`);
    },
    onProgress(done, total, item) {
      finished = done;
      if (!many) return;
      const label = item.status === 'failed' ? `failed ${item.relPath}: ${item.error}` : `${item.status} ${item.url || item.publicId}`;
      ctx.out.progress(`[${done}/${total}] ${label}`);
    },
  });

  const { failed, total } = result.summary;
  if (!many && failed) {
    const it = result.items[0];
    throw new CldshError(it.error_code || CODES.API, `Upload of ${it.relPath} failed: ${it.error}`, { hint: it.error_hint });
  }
  if (failed) ctx.setExitCode(failed === total ? EXIT.ERROR : EXIT.PARTIAL);
  return { ...result, dryRun: false };
}

export function render(result, ctx) {
  const { out } = ctx;
  const c = out.c;
  if (result.dryRun) {
    const n = result.items.length;
    if (!n) out.print(`No files to upload in ${result.localPath}`);
    result.items.forEach((it, i) => {
      const collision = it.hasCollision ? c.yellow(' (renamed: same name as another file)') : '';
      out.print(`[${i + 1}/${n}] Would upload: ${it.relPath} -> ${it.publicId} (${it.resourceType}, ${formatBytes(it.bytes)})${collision}`);
    });
    if (result.skippedDirectories) out.warn(`Skipped ${result.skippedDirectories} subdirector${result.skippedDirectories === 1 ? 'y' : 'ies'}; use -r to include them.`);
    out.info('Dry run: nothing was uploaded.');
    return;
  }

  if (!result.isDirectory) {
    const it = result.items[0];
    if (it.status === 'skipped') out.print(`Skipped (already exists): ${it.publicId}`);
    else out.success(`Uploaded (${it.status}): ${it.url || it.publicId}`);
    if (it.response) out.print(JSON.stringify(it.response, null, 2));
    return;
  }

  for (const it of result.items) {
    if (it.response) out.print(JSON.stringify(it.response, null, 2));
  }
  const s = result.summary;
  if (!s.total) out.print(`No files to upload in ${result.localPath}`);
  else {
    const line = `Uploaded ${s.created + s.overwritten} of ${s.total} file(s): ${s.created} created · ${s.overwritten} overwritten · ${s.skipped} skipped · ${s.failed} failed`;
    if (s.failed) out.print(c.yellow(line));
    else out.success(line);
  }
  for (const it of result.items.filter(i => i.status === 'failed')) out.error(`  failed ${it.relPath}: ${it.error}`);
}
