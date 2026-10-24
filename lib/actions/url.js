import { v2 as cloudinary } from 'cloudinary';
import * as cld from '../cld.js';
import { isGlob, parseGlobTarget } from '../glob.js';

export async function actionUrl(targetArg = '', {
  cwd = '',
  transformation = null,
  signed = false,
  deliveryType = null,
  resourceType = 'image',
} = {}) {
  if (!targetArg) {
    throw new Error('url requires an asset name, path, or pattern.');
  }

  const type = deliveryType || (signed ? 'authenticated' : 'upload');

  if (isGlob(targetArg)) {
    const globInfo = parseGlobTarget(cwd, targetArg);
    const targetFolder = globInfo.folderPart ? cld.resolvePath(cwd, globInfo.folderPart) : cld.norm(cwd);

    const filesRaw = await cld.listFilesImmediate(targetFolder, { resource_type: resourceType, max: 200 });
    const matchingFiles = filesRaw.filter(r => {
      const name = r.public_id.split('/').pop();
      return globInfo.regex.test(name) || globInfo.regex.test(`${name}.${r.format || ''}`);
    });

    const items = matchingFiles.map(r => {
      if (signed) {
        const signedUrl = cloudinary.url(r.public_id, {
          secure: true,
          resource_type: resourceType,
          type,
          sign_url: true,
          raw_transformation: transformation || undefined,
        });
        return { public_id: r.public_id, url: signedUrl };
      }

      let out = r.secure_url || r.url;
      if (transformation) {
        const t = String(transformation).replace(/^\/+|\/+$/g, '');
        out = out.replace('/upload/', `/upload/${t}/`);
      }
      return { public_id: r.public_id, url: out };
    });

    return { isGlob: true, items };
  }

  const publicId = targetArg.includes('/') ? targetArg : cld.join(cwd, targetArg);

  if (signed) {
    const signedUrl = cloudinary.url(publicId, {
      secure: true,
      resource_type: resourceType,
      type,
      sign_url: true,
      raw_transformation: transformation || undefined,
    });
    return { isGlob: false, items: [{ public_id: publicId, url: signedUrl }] };
  }

  const res = await cloudinary.api.resource(publicId, { resource_type: resourceType, type });
  let out = res.secure_url || res.url;
  if (transformation) {
    const t = String(transformation).replace(/^\/+|\/+$/g, '');
    out = out.replace('/upload/', `/upload/${t}/`);
  }

  return { isGlob: false, items: [{ public_id: publicId, url: out }] };
}
