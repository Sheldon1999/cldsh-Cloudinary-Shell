import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveLocal(p) {
  if (!p) return '';
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(process.cwd(), p);
}

export default async function upload(ctx, args, flags) {
  const { utils, printer } = ctx;

  const rawPath = args[0];
  const customName = args[1];

  if (!rawPath) {
    return printer.println(printer.warn('upload <local_path> [name] [-o] [--rt=image] [-v]'));
  }

  const localPath = resolveLocal(rawPath);
  if (!fs.existsSync(localPath)) {
    return printer.println(printer.error('File not found: ' + localPath));
  }

  const rtype = flags.rt || 'image';
  const overwrite = flags.o !== undefined ? !!flags.o : true;
  const defaultName = path.parse(localPath).name; // basename without extension
  const name = customName || defaultName;

  const publicId = utils.join(ctx.cwd, name);

  try {
    const res = await utils.uploadFile(localPath, publicId, { resource_type: rtype, overwrite });

    // Prefer secure_url; fall back to url; if neither, show something helpful.
    const url = res?.secure_url || res?.url || null;
    const out = url
      ? `Uploaded: ${url}`
      : `Uploaded: (no URL in response)\npublic_id=${res?.public_id || publicId}`;

    // Print plain string to avoid any accidental object coercion.
    console.log(out);

    // Optional: verbose raw response for debugging
    if (flags.v) {
      console.log('\nRAW RESPONSE:\n' + JSON.stringify(res, null, 2));
    }
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
