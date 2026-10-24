import * as cld from '../cld.js';

export async function actionTree(folder = '', {
  cwd = '',
  depth = Infinity,
  resourceType = 'image',
  maxFilesPerDir = 100,
} = {}) {
  const target = folder ? cld.resolvePath(cwd, folder) : cld.norm(cwd);
  const node = await cld.buildTree(target, { depth, resource_type: resourceType, maxFilesPerDir });
  return node;
}
