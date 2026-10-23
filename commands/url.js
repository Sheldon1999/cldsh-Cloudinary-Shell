import { v2 as cloudinary } from 'cloudinary';
import { isGlob, parseGlobTarget } from '../lib/glob.js';

export default async function url(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const a0 = args[0];
  if (!a0) return printer.println(printer.warn('url <name|public_id|pattern> [--rt=image] [--t="..."] [--signed] [--type=...]'));

  const rtype = flags.rt || flags['resource-type'] || 'image';
  const deliveryType = flags.type || (flags.signed ? 'authenticated' : 'upload');

  // Wildcard pattern matching (e.g. url cld* or url *.png)
  if (isGlob(a0)) {
    const globInfo = parseGlobTarget(ctx.cwd, a0);
    const targetFolder = globInfo.folderPart ? utils.resolvePath(ctx.cwd, globInfo.folderPart) : utils.norm(ctx.cwd);

    try {
      const filesRaw = await utils.listFilesImmediate(targetFolder, { resource_type: rtype, max: 200 });
      const matchingFiles = filesRaw.filter(r => {
        const name = r.public_id.split('/').pop();
        return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
      });

      if (!matchingFiles.length) {
        return printer.println(printer.warn(`No assets found matching pattern: ${a0}`));
      }

      for (const r of matchingFiles) {
        if (flags.signed) {
          const signedUrl = cloudinary.url(r.public_id, {
            secure: true,
            resource_type: rtype,
            type: deliveryType,
            sign_url: true,
            raw_transformation: flags.t || undefined,
          });
          printer.println(`${r.public_id}: ${signedUrl}`);
        } else {
          let out = r.secure_url || r.url;
          if (flags.t) {
            const t = String(flags.t).replace(/^\/+|\/+$/g, '');
            out = out.replace('/upload/', `/upload/${t}/`);
          }
          printer.println(`${r.public_id}: ${out}`);
        }
      }
    } catch (e) {
      printer.println(printer.error(e?.message || String(e)));
    }
    return;
  }

  // Single asset URL
  const publicId = a0.includes('/') ? a0 : utils.join(ctx.cwd, a0);

  try {
    if (flags.signed) {
      const signedUrl = cloudinary.url(publicId, {
        secure: true,
        resource_type: rtype,
        type: deliveryType,
        sign_url: true,
        raw_transformation: flags.t || undefined,
      });
      printer.println(signedUrl);
      return;
    }

    const res = await cloudinary.api.resource(publicId, { resource_type: rtype, type: deliveryType });
    let out = res.secure_url || res.url;
    if (flags.t) {
      const t = String(flags.t).replace(/^\/+|\/+$/g, '');
      out = out.replace('/upload/', `/upload/${t}/`);
    }
    printer.println(out);
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
