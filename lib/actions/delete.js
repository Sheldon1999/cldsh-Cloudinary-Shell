import * as cld from '../cld.js';
import { isGlob, parseGlobTarget } from '../glob.js';

export async function actionDelete(targetArg = '', {
  cwd = '',
  recursive = false,
  resourceType = 'image',
  dryRun = false,
} = {}) {
  if (!targetArg) {
    throw new Error('delete requires an asset or folder name/pattern.');
  }

  // 1. Wildcard deletion
  if (isGlob(targetArg)) {
    const globInfo = parseGlobTarget(cwd, targetArg);
    const targetFolder = globInfo.folderPart ? cld.resolvePath(cwd, globInfo.folderPart) : cld.norm(cwd);

    if (recursive) {
      const subs = targetFolder ? await cld.subFolders(targetFolder) : await cld.rootFolders();
      const matchingFolders = subs.filter(s => globInfo.regex.test(s));
      const filesRaw = await cld.listFilesImmediate(targetFolder, { resource_type: resourceType, max: 500 });
      const matchingFiles = filesRaw.filter(r => {
        const name = r.public_id.split('/').pop();
        return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
      });

      const deletedFolders = matchingFolders.map(f => cld.join(targetFolder, f));
      const deletedAssets = matchingFiles.map(r => r.public_id);

      if (!dryRun) {
        for (const f of deletedFolders) {
          await cld.deleteFolderRecursive(f);
        }
        for (const id of deletedAssets) {
          await cld.deleteAsset(id, { resource_type: resourceType });
        }
      }

      return {
        target: targetArg,
        isGlob: true,
        recursive: true,
        dryRun,
        deletedFolders,
        deletedAssets,
        total: deletedFolders.length + deletedAssets.length,
      };
    }

    // Non-recursive wildcard
    const filesRaw = await cld.listFilesImmediate(targetFolder, { resource_type: resourceType, max: 500 });
    const matchingFiles = filesRaw.filter(r => {
      const name = r.public_id.split('/').pop();
      return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
    });

    const deletedAssets = matchingFiles.map(r => r.public_id);
    if (!dryRun) {
      for (const id of deletedAssets) {
        await cld.deleteAsset(id, { resource_type: resourceType });
      }
    }

    return {
      target: targetArg,
      isGlob: true,
      recursive: false,
      dryRun,
      deletedFolders: [],
      deletedAssets,
      total: deletedAssets.length,
    };
  }

  // 2. Exact folder recursive delete
  if (recursive) {
    const full = cld.join(cwd, targetArg);
    if (!dryRun) {
      await cld.deleteFolderRecursive(full);
    }
    return {
      target: full,
      isGlob: false,
      recursive: true,
      dryRun,
      deletedFolders: [full],
      deletedAssets: [],
      total: 1,
    };
  }

  // 3. Exact single asset delete
  const target = targetArg.includes('/') ? targetArg : cld.join(cwd, targetArg);
  let res = null;
  if (!dryRun) {
    res = await cld.deleteAsset(target, { resource_type: resourceType });
  }

  return {
    target,
    isGlob: false,
    recursive: false,
    dryRun,
    deletedFolders: [],
    deletedAssets: [target],
    status: res?.result || (dryRun ? 'dry_run' : 'ok'),
    total: 1,
  };
}
