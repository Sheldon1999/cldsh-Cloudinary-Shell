import { v2 as cloudinary } from 'cloudinary';

export default async function url(ctx, args, flags) {
  const { utils, printer } = ctx;
  const a0 = args[0];
  if (!a0) return printer.println(printer.warn('url <name|public_id> [--rt=image] [--t="f_auto,q_auto,w_800"] [--signed] [--type=authenticated]'));

  const rtype = flags.rt || 'image';
  const deliveryType = flags.type || (flags.signed ? 'authenticated' : 'upload'); // sensible default
  const publicId = a0.includes('/') ? a0 : utils.join(ctx.cwd, a0);

  try {
    if (flags.signed) {
      // Signed delivery (works best when the asset was uploaded with type=authenticated)
      const signedUrl = cloudinary.url(publicId, {
        secure: true,
        resource_type: rtype,
        type: deliveryType,           // usually 'authenticated'
        sign_url: true,               // adds signature to the URL
        raw_transformation: flags.t || undefined, // optional transforms
      });
      printer.println(signedUrl);
      return;
    }

    // Public URL (default)
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

