import { actionUrl } from '../lib/actions/url.js';

export default async function url(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const a0 = args[0];
  if (!a0) {
    return printer.println(printer.warn('url <name|public_id|pattern> [--rt=image] [--t="..."] [--signed] [--type=...] [--json]'));
  }

  const resourceType = flags.rt || flags['resource-type'] || 'image';
  const deliveryType = flags.type || (flags.signed ? 'authenticated' : 'upload');

  try {
    const result = await actionUrl(a0, {
      cwd: ctx.cwd,
      transformation: flags.t,
      signed: Boolean(flags.signed),
      deliveryType,
      resourceType,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    if (result.items.length === 1 && !result.isGlob) {
      printer.println(result.items[0].url);
    } else {
      for (const item of result.items) {
        printer.println(`${item.public_id}: ${item.url}`);
      }
    }
    return result;
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
    if (flags.json) throw e;
  }
}
