import * as cld from '../cld.js';
import { isGlob, parseGlobTarget } from '../glob.js';

export async function actionList(target = '', { cwd = '', resourceType = 'image', max = 200 } = {}) {
  let here = cld.norm(cwd);
  let globFilter = null;

  if (target) {
    if (isGlob(target)) {
      const globInfo = parseGlobTarget(cwd, target);
      here = globInfo.folderPart ? cld.resolvePath(cwd, globInfo.folderPart) : cld.norm(cwd);
      globFilter = globInfo.regex;
    } else {
      here = cld.resolvePath(cwd, target);
      const exists = await cld.folderExists(here);
      if (!exists) {
        throw new Error(`No such folder: ${target}`);
      }
    }
  }

  const rawFolders = here ? await cld.subFolders(here) : await cld.rootFolders();
  let folders = [...rawFolders].sort((a, b) => a.localeCompare(b));
  if (globFilter) {
    folders = folders.filter(f => globFilter.test(f));
  }

  const filesRaw = await cld.listFilesImmediate(here, { resource_type: resourceType, max });
  let files = filesRaw
    .map(r => ({
      display: r.public_id.split('/').pop(),
      public_id: r.public_id,
      format: r.format,
      bytes: r.bytes,
      width: r.width,
      height: r.height,
      resource_type: r.resource_type,
      created_at: r.created_at,
      secure_url: r.secure_url,
      url: r.url,
    }))
    .sort((a, b) => a.display.localeCompare(b.display));

  if (globFilter) {
    files = files.filter(r => globFilter.test(r.display) || globFilter.test(`${r.display}.${r.format || ''}`));
  }

  return {
    folder: here || '/',
    folders,
    files,
  };
}
