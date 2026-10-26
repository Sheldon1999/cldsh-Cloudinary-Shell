import { spawn } from 'node:child_process';
import process from 'node:process';
import { buildAssetUrl } from '../lib/actions/url.js';
import { usageError } from '../lib/errors.js';
import { RT_FLAG, TYPE_FLAG, resourceTypeFrom } from '../lib/flags.js';

export const spec = {
  name: 'open',
  usage: 'open <name|public_id|asset_id:ID> [--t="<transformation>"] [--rt=image|video|raw] [--type=upload]',
  summary: 'Open an asset in the browser',
  flags: {
    t: { type: 'string', placeholder: 'transformation', description: 'Transformation to apply, e.g. --t="w_300,c_fill"' },
    ...RT_FLAG,
    ...TYPE_FLAG,
  },
  notes: ['When the output is not a terminal (scripts, pipes), the URL is printed instead of opening a browser.'],
};

export function launchUrl(url) {
  let cmd;
  let args;
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd.exe';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  // A missing opener (e.g. no xdg-open) must not crash the shell; the URL is printed anyway.
  child.on('error', () => {});
  child.unref();
}

export default async function openCmd(ctx, args, flags) {
  if (!args[0]) throw usageError('open needs an asset name', spec.usage);
  const backend = await ctx.backend();
  const ref = await backend.resolveAsset(ctx.cwd, args[0], { resourceType: resourceTypeFrom(flags), deliveryType: flags.type });
  // Private and authenticated assets are only viewable through signed URLs.
  const url = buildAssetUrl(backend, ref, { transformation: flags.t, signed: ref.type !== 'upload' });
  const launch = !flags.json && ctx.session.mode !== 'mcp' && Boolean(process.stdout.isTTY);
  if (launch) launchUrl(url);
  return { public_id: ref.public_id, resource_type: ref.resource_type, type: ref.type, url, launched: launch };
}

export function render(result, ctx) {
  if (result.launched) ctx.out.success(`Opening: ${result.url}`);
  else ctx.out.print(result.url);
}
