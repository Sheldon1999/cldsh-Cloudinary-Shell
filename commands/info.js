import { v2 as cloudinary } from 'cloudinary';

export default async function info(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const targetArg = args[0];

  if (!targetArg) {
    return printer.println(printer.warn('info <name|public_id> [--rt=image] [-v]'));
  }

  const publicId = targetArg.includes('/') ? targetArg : utils.join(ctx.cwd, targetArg);
  const rtype = flags.rt || flags['resource-type'] || 'image';

  try {
    const res = await cloudinary.api.resource(publicId, { resource_type: rtype });

    if (flags.v) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    printer.printInfoCard(res);
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
}
