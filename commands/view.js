import { v2 as cloudinary } from 'cloudinary';
import process from 'node:process';

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

export default async function view(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const targetArg = args[0];

  if (!targetArg) {
    return printer.println(printer.warn('view <name|public_id> [--rt=image|video] [--t="..."]'));
  }

  const publicId = targetArg.includes('/') ? targetArg : utils.join(ctx.cwd, targetArg);
  const rtype = flags.rt || flags['resource-type'] || 'image';

  // Base transformation: cap to max width for terminal display
  let transformStr;
  if (rtype === 'video') {
    transformStr = flags.t ? `so_0,${flags.t},w_800,c_limit` : 'so_0,w_600,c_limit,q_auto';
  } else {
    transformStr = flags.t ? `${flags.t},w_800,c_limit` : 'w_600,c_limit,q_auto';
  }

  const previewUrl = cloudinary.url(publicId, {
    secure: true,
    resource_type: rtype,
    format: 'png',
    raw_transformation: transformStr,
  });

  printer.println(printer.dim(`Fetching preview for ${publicId} ...`));

  try {
    const res = await fetch(previewUrl);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Asset not found: ${publicId}`);
      }
      throw new Error(`Failed to fetch preview (${res.status}): ${res.statusText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());

    if (isTerminalGraphicsSupported()) {
      process.stdout.write('\n');
      process.stdout.write(renderItermImage(buf));
      printer.println(printer.dim(`  ${publicId} • ${printer.formatBytes(buf.length)} preview\n`));
    } else {
      printer.println(printer.warn(`\nTerminal "${process.env.TERM_PROGRAM || 'standard'}" does not support inline graphics.`));
      printer.println(`Preview URL: ${printer.ok(previewUrl)}`);
      printer.println(printer.dim(`Type "open ${targetArg}" to view in your browser.\n`));
    }
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
