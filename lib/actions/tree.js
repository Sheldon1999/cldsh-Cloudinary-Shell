import { join, resolveRemote } from '../paths.js';
import { RESOURCE_TYPES } from '../backend/index.js';

/**
 * Folder tree. Node: { name, path, files: AssetRef[], dirs: Node[], truncated }.
 * `depth` 0 lists only `target` itself.
 */
export async function actionTree(backend, { cwd = '', target = '', depth = Infinity, resourceTypes = RESOURCE_TYPES, maxFilesPerDir = 100 } = {}) {
  const root = resolveRemote(cwd, target || '.');
  await backend.requireFolder(root, target || root);

  async function build(path, remaining) {
    const [{ assets, truncated }, subs] = await Promise.all([
      backend.listAssets(path, { resourceTypes, max: maxFilesPerDir }),
      remaining > 0 ? backend.listFolders(path) : Promise.resolve([]),
    ]);
    const dirs = [];
    for (const name of subs) dirs.push(await build(join(path, name), remaining - 1));
    return { name: path ? path.split('/').pop() : '/', path, files: assets, dirs, truncated };
  }

  return build(root, depth);
}
