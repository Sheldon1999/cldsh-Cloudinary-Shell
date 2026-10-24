import { v2 as cloudinary } from 'cloudinary';
import * as cld from '../cld.js';

export async function actionMove(sourceArg = '', targetArg = '', {
  cwd = '',
  resourceType = 'image',
  overwrite = false,
  dryRun = false,
} = {}) {
  if (!sourceArg || !targetArg) {
    throw new Error('move requires a source and target.');
  }

  const fromPublicId = sourceArg.includes('/') ? cld.norm(sourceArg) : cld.join(cwd, sourceArg);
  const baseName = fromPublicId.split('/').pop();

  let toPublicId;
  if (targetArg.endsWith('/')) {
    const targetFolder = cld.resolvePath(cwd, targetArg);
    toPublicId = cld.join(targetFolder, baseName);
  } else {
    const potentialFolder = cld.resolvePath(cwd, targetArg);
    const isFolder = await cld.folderExists(potentialFolder);
    if (isFolder && potentialFolder) {
      toPublicId = cld.join(potentialFolder, baseName);
    } else {
      toPublicId = targetArg.includes('/') ? cld.resolvePath(cwd, targetArg) : cld.join(cwd, targetArg);
    }
  }

  if (fromPublicId === toPublicId) {
    throw new Error(`Source and target are identical: ${fromPublicId}`);
  }

  if (dryRun) {
    return {
      from: fromPublicId,
      to: toPublicId,
      moved: false,
      dryRun: true,
    };
  }

  const res = await cloudinary.uploader.rename(fromPublicId, toPublicId, {
    resource_type: resourceType,
    overwrite,
    invalidate: true,
  });

  return {
    from: fromPublicId,
    to: res.public_id || toPublicId,
    moved: true,
    dryRun: false,
    res,
  };
}
