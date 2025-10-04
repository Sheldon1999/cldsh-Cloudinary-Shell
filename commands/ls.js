export default async function ls(ctx, args, flags) {
  const { utils, printer } = ctx;
  const here = utils.norm(ctx.cwd);
  // folders
  const folders = here ? await utils.subFolders(here) : await utils.rootFolders();
  // files (immediate)
  const rtype = flags.rt || flags['resource-type'] || 'image';
  const filesRaw = await utils.listFilesImmediate(here, { resource_type: rtype, max: 200 });
  const files = filesRaw.map(r => ({ display: r.public_id.split('/').pop(), ...r }));
  printer.printList({ folders, files, long: !!flags.l });
}
