import { v2 as cloudinary } from 'cloudinary';
import * as cld from '../cld.js';

export async function actionInfo(targetArg = '', { cwd = '', resourceType = 'image' } = {}) {
  if (!targetArg) {
    throw new Error('info requires an asset public ID or name.');
  }

  const publicId = targetArg.includes('/') ? targetArg : cld.join(cwd, targetArg);
  const res = await cloudinary.api.resource(publicId, { resource_type: resourceType });
  return res;
}
