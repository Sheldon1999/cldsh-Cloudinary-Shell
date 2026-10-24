import { actionInfo } from '../lib/actions/info.js';

export default async function info(ctx, args = [], flags = {}) {
  const { printer } = ctx;
  const targetArg = args[0];

  if (!targetArg) {
    return printer.println(printer.warn('info <name|public_id> [--rt=image] [--json] [-v]'));
  }

  const rtype = flags.rt || flags['resource-type'] || 'image';

  try {
    const res = await actionInfo(targetArg, {
      cwd: ctx.cwd,
      resourceType: rtype,
    });

    if (flags.json || flags.v) {
      console.log(JSON.stringify(res, null, 2));
      return res;
    }

    printer.printInfoCard(res);
    return res;
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
    if (flags.json) throw e;
  }
}
