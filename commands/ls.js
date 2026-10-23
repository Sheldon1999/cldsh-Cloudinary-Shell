import { isGlob, parseGlobTarget } from '../lib/glob.js';

export default async function ls(ctx, args = [], flags = {}) {
  const { utils, printer } = ctx;
  const target = args[0];

  let here = utils.norm(ctx.cwd);
  let globFilter = null;

  if (target) {
    if (isGlob(target)) {
      const globInfo = parseGlobTarget(ctx.cwd, target);
      here = globInfo.folderPart ? utils.resolvePath(ctx.cwd, globInfo.folderPart) : utils.norm(ctx.cwd);
      globFilter = globInfo.regex;
    } else {
      here = utils.resolvePath(ctx.cwd, target);
      const exists = await utils.folderExists(here);
      if (!exists) {
        return printer.println(printer.warn(`No such folder: ${target}`));
      }
    }
  }

  // folders
  const rawFolders = here ? await utils.subFolders(here) : await utils.rootFolders();
  let folders = [...rawFolders].sort((a, b) => a.localeCompare(b));
  if (globFilter) {
    folders = folders.filter(f => globFilter.test(f));
  }

  // files (immediate)
  const rtype = flags.rt || flags['resource-type'] || 'image';
  const max = flags.max !== undefined ? Number(flags.max) : 200;
  const filesRaw = await utils.listFilesImmediate(here, { resource_type: rtype, max });
  let files = filesRaw
    .map(r => ({ display: r.public_id.split('/').pop(), ...r }))
    .sort((a, b) => a.display.localeCompare(b.display));

  if (globFilter) {
    files = files.filter(r => globFilter.test(r.display) || globFilter.test(`${r.display}.${r.format || ''}`));
  }

  printer.printList({ folders, files, long: !!flags.l });
}
