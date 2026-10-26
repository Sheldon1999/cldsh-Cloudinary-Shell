// Delivery URLs for assets (`url`, `view`, `open`, MCP `cloudinary_get_url`).
// URLs are built by the SDK from the resolved asset (resource type, delivery type, version, format),
// so they match the asset's own `secure_url` when nothing is added.
import { CldshError, CODES, toCldError, usageError } from '../errors.js';
import { isGlob } from '../glob.js';

/**
 * Build the URL of one asset.
 * - `transformation`: raw transformation string (e.g. "w_300,c_fill/e_grayscale").
 * - `signed`: sign the URL (needed for `authenticated` assets). A signed request for the original of a
 *   `private` asset returns a time-limited `private_download_url` instead.
 * - `format`: override the delivery format (images and videos only).
 */
export function buildAssetUrl(backend, ref, { transformation, signed = false, format } = {}) {
  const t = transformation ? String(transformation).replace(/^\/+|\/+$/g, '') : '';
  const media = ref.resource_type !== 'raw';
  const fmt = media ? (format || ref.format) : undefined;
  if (signed && ref.type === 'private' && !t) {
    return backend.sdk.utils.private_download_url(ref.public_id, fmt || '', {
      resource_type: ref.resource_type,
      type: 'private',
    });
  }
  return backend.sdk.url(ref.public_id, {
    resource_type: ref.resource_type,
    type: ref.type,
    secure: true,
    ...(ref.version ? { version: ref.version } : {}),
    ...(fmt ? { format: fmt } : {}),
    ...(t ? { raw_transformation: t } : {}),
    ...(signed ? { sign_url: true } : {}),
  });
}

async function resolveTarget(backend, cwd, target, { resourceType, deliveryType, signed }) {
  if (isGlob(target)) {
    const { assets } = await backend.findByGlob(cwd, target, {
      ...(resourceType ? { resourceTypes: [resourceType] } : {}),
      deliveryTypes: deliveryType ? [deliveryType] : (signed ? ['upload', 'private', 'authenticated'] : ['upload']),
    });
    if (!assets.length) throw new CldshError(CODES.NOT_FOUND, `No assets match ${target}`);
    return assets;
  }
  // --signed without --type: look for an authenticated asset first (what 1.0.0 assumed), then any.
  const types = deliveryType ? [deliveryType] : (signed ? ['authenticated', undefined] : [undefined]);
  let lastError;
  for (const type of types) {
    try {
      return [await backend.resolveAsset(cwd, target, { resourceType, deliveryType: type })];
    } catch (e) {
      if (e.code !== CODES.NOT_FOUND) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * URLs for one or more targets (names, paths, public IDs, `asset_id:<id>`, or wildcards).
 * With several targets, targets that fail are reported in `failed` and the rest still get URLs;
 * a single failing target throws.
 * @returns {Promise<{ items: { public_id, resource_type, type, url }[], failed?: object[] }>}
 */
export async function actionUrl(backend, { cwd = '', targets, transformation, signed = false, deliveryType, resourceType } = {}) {
  const list = (Array.isArray(targets) ? targets : [targets]).map(t => String(t ?? '').trim()).filter(Boolean);
  if (!list.length) throw usageError('url needs an asset name, path or pattern');
  const rt = resourceType && resourceType !== 'all' ? resourceType : undefined;

  const items = [];
  const failed = [];
  const seen = new Set();
  for (const target of list) {
    let refs;
    try {
      refs = await resolveTarget(backend, cwd, target, { resourceType: rt, deliveryType, signed });
    } catch (e) {
      const err = toCldError(e);
      if (list.length === 1 || err.code === CODES.USAGE) throw err;
      failed.push({ target, ...err.toJSON() });
      continue;
    }
    for (const ref of refs) {
      const key = `${ref.resource_type}/${ref.type}/${ref.public_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        public_id: ref.public_id,
        resource_type: ref.resource_type,
        type: ref.type,
        name: ref.name,
        target,
        url: buildAssetUrl(backend, ref, { transformation, signed }),
      });
    }
  }
  if (!items.length) throw new CldshError(CODES.NOT_FOUND, failed[0].message, { details: failed });
  return failed.length ? { items, failed } : { items };
}
