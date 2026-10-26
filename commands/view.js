import process from 'node:process';
import { buildAssetUrl } from '../lib/actions/url.js';
import { CldshError, CODES, usageError } from '../lib/errors.js';
import { formatBytes } from '../lib/printer.js';
import { RT_FLAG, TYPE_FLAG, resourceTypeFrom } from '../lib/flags.js';

export const spec = {
  name: 'view',
  aliases: ['preview'],
  usage: 'view <name|public_id|asset_id:ID> [--t="<transformation>"] [--rt=image|video] [--type=upload]',
  summary: 'Show an image or video thumbnail in the terminal (iTerm2, WezTerm, Ghostty, VS Code, Warp)',
  flags: {
    t: { type: 'string', placeholder: 'transformation', description: 'Transformation applied before the preview sizing' },
    ...RT_FLAG,
    ...TYPE_FLAG,
  },
  notes: ['Terminals without inline graphics (and non-terminal output) get the preview URL instead.'],
};

const PREVIEW = 'w_600,c_limit,q_auto';

export function isTerminalGraphicsSupported() {
  const tp = process.env.TERM_PROGRAM || '';
  const lc = process.env.LC_TERMINAL || '';
  const known = ['WarpTerminal', 'iTerm.app', 'WezTerm', 'vscode', 'ghostty'];
  return known.includes(tp) || lc === 'iTerm2' || Boolean(process.env.GHOSTTY_RESOURCES_DIR);
}

export function renderItermImage(buffer, { width = 'auto', preserveAspectRatio = 1 } = {}) {
  const base64 = buffer.toString('base64');
  return `\u001B]1337;File=inline=1;width=${width};preserveAspectRatio=${preserveAspectRatio}:${base64}\u0007\n`;
}

/** PNG preview URL: images scaled to 600px; videos as their first frame. */
export function previewUrl(backend, ref, transformation) {
  const user = transformation ? String(transformation).replace(/^\/+|\/+$/g, '') : '';
  const steps = ref.resource_type === 'video' ? ['so_0', user, PREVIEW] : [user, PREVIEW];
  return buildAssetUrl(backend, ref, {
    transformation: steps.filter(Boolean).join('/'),
    format: 'png',
    signed: ref.type !== 'upload',
  });
}

export default async function view(ctx, args, flags) {
  if (!args[0]) throw usageError('view needs an asset name', spec.usage);
  const backend = await ctx.backend();
  const ref = await backend.resolveAsset(ctx.cwd, args[0], { resourceType: resourceTypeFrom(flags), deliveryType: flags.type });
  if (ref.resource_type === 'raw') {
    throw usageError(`${ref.public_id} is a raw file; only images and videos can be previewed`, `run "url ${args[0]}" for its URL`);
  }
  const result = {
    public_id: ref.public_id,
    resource_type: ref.resource_type,
    type: ref.type,
    url: previewUrl(backend, ref, flags.t),
    inline: false,
  };
  if (flags.json || !process.stdout.isTTY || !isTerminalGraphicsSupported()) return result;

  ctx.out.info(`Fetching preview for ${ref.public_id} ...`);
  let res;
  try {
    res = await fetch(result.url);
  } catch (e) {
    throw new CldshError(CODES.NETWORK, `Could not fetch the preview: ${e.cause?.message || e.message}`);
  }
  if (!res.ok) {
    throw new CldshError(res.status === 404 ? CODES.NOT_FOUND : CODES.API, `Could not fetch the preview (HTTP ${res.status})`, {
      httpCode: res.status,
      hint: res.status === 404 || res.status === 401 ? 'The transformation may be invalid or not allowed for this asset.' : undefined,
    });
  }
  result.inline = true;
  // The image bytes are for render only; they stay out of --json output.
  Object.defineProperty(result, 'image', { value: Buffer.from(await res.arrayBuffer()), enumerable: false });
  return result;
}

export function render(result, ctx) {
  if (result.image) {
    ctx.out.raw('\n' + renderItermImage(result.image));
    ctx.out.info(`  ${result.public_id} • ${formatBytes(result.image.length)} preview`);
    return;
  }
  ctx.out.print(result.url);
  if (process.stdout.isTTY) {
    ctx.out.info(`Terminal "${process.env.TERM_PROGRAM || 'standard'}" does not show inline images; "open" shows the asset in the browser.`);
  }
}
