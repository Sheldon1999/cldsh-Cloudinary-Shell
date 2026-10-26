import { isGlob } from '../glob.js';
import { resolveRemote } from '../paths.js';
import { RESOURCE_TYPES } from '../backend/index.js';

/**
 * List a folder (or the matches of a wildcard pattern).
 * @returns {Promise<{ folder: string, folders: string[], files: object[], truncated: boolean }>}
 */
export async function actionList(backend, { cwd = '', target = '', resourceTypes = RESOURCE_TYPES, deliveryTypes = ['upload'], max = Infinity } = {}) {
  if (target && isGlob(target)) {
    const { folder, assets, folders } = await backend.findByGlob(cwd, target, { resourceTypes, deliveryTypes, includeFolders: true });
    const files = assets.slice(0, max);
    return { folder: folder || '/', folders, files, truncated: assets.length > max };
  }
  const folder = resolveRemote(cwd, target || '.');
  await backend.requireFolder(folder, target || folder);
  const [folders, { assets, truncated }] = await Promise.all([
    backend.listFolders(folder),
    backend.listAssets(folder, { resourceTypes, deliveryTypes, max }),
  ]);
  return { folder: folder || '/', folders, files: assets, truncated };
}
