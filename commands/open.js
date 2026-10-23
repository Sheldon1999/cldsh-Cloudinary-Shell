import { v2 as cloudinary } from 'cloudinary';
import { spawn } from 'node:child_process';
import process from 'node:process';

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
  child.unref();
}

export default async function openCmd(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const targetArg = args[0];

  if (!targetArg) {
    return printer.println(printer.warn('open <name|public_id> [--rt=image] [--t="..."]'));
  }

  const publicId = targetArg.includes('/') ? targetArg : utils.join(ctx.cwd, targetArg);
  const rtype = flags.rt || flags['resource-type'] || 'image';

  try {
    const res = await cloudinary.api.resource(publicId, { resource_type: rtype });
    let targetUrl = res.secure_url || res.url;
    if (flags.t) {
      const t = String(flags.t).replace(/^\/+|\/+$/g, '');
      targetUrl = targetUrl.replace('/upload/', `/upload/${t}/`);
    }

    printer.println(printer.ok(`Opening: ${targetUrl}`));
    launchUrl(targetUrl);
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
