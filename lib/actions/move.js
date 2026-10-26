// Move or rename an asset or a folder (`mv`, MCP `cloudinary_move`).
//
// planMove resolves everything and checks for conflicts without changing anything; executeMove
// carries out exactly that plan. What "move" means depends on the folder mode (see lib/backend):
// - dynamic: an asset moves by changing its asset folder and is renamed by changing its display
//   name, so its delivery URL stays the same. `changePublicId` also renames the public ID (new URL).
//   Folders move with rename_folder.
// - fixed: the folder is part of the public ID, so every asset move renames the public ID (new URL),
//   and Cloudinary cannot move folders.
import { CldshError, CODES, usageError } from '../errors.js';
import { resolveRemote, join, parentOf, baseName, isWithin } from '../paths.js';

const FIXED_FOLDER_MOVE = 'Moving or renaming folders is not supported by Cloudinary in fixed folder mode';
const FIXED_FOLDER_HINT = 'Move the assets individually, or ask Cloudinary support to migrate the product environment to dynamic folders.';

const display = (p) => `/${p}`;

/** Does `publicId` exist for this resource and delivery type? Costs one Admin API call. */
async function publicIdExists(backend, publicId, { resource_type, type }) {
  try {
    const r = await backend.call(() => backend.sdk.api.resource(publicId, { resource_type, type }));
    return { asset_id: r.asset_id, public_id: r.public_id, resource_type: r.resource_type, type: r.type };
  } catch (e) {
    if (e.code === CODES.NOT_FOUND) return null;
    throw e;
  }
}

/**
 * "hero2.png" typed for an image named "hero" means "hero2": images and videos keep the format
 * outside the name. Raw files keep their extension.
 */
function cleanName(name, ref) {
  if (!name || ref.resource_type === 'raw' || !ref.format) return name;
  const ext = `.${ref.format}`.toLowerCase();
  if (name.toLowerCase().endsWith(ext) && !ref.name.toLowerCase().endsWith(ext) && name.length > ext.length) {
    return name.slice(0, -ext.length);
  }
  return name;
}

/**
 * Work out a move without changing anything.
 * @returns {Promise<object>} plan: { kind: 'asset'|'folder', cloud, mode, from, to, urlChanged, targetExists, ... }
 */
export async function planMove(backend, {
  cwd = '',
  source,
  target,
  changePublicId = false,
  overwrite = false,
  resourceType,
  deliveryType,
} = {}) {
  const srcArg = String(source ?? '').trim();
  const tgtArg = String(target ?? '').trim();
  if (!srcArg || !tgtArg) throw usageError('mv needs a source and a target', 'mv <source> <target>');

  const src = resolveRemote(cwd, srcArg);
  const tgt = resolveRemote(cwd, tgtArg);
  const explicitFolder = /[/\\]$/.test(tgtArg);
  const base = { cloud: backend.cloudName, mode: backend.mode, overwrite: Boolean(overwrite) };

  const sourceIsFolder = src !== '' && await backend.folderExists(src);
  if (!src || sourceIsFolder || /[/\\]$/.test(srcArg)) {
    if (!src) throw usageError('The root folder cannot be moved');
    if (!sourceIsFolder) throw new CldshError(CODES.NOT_FOUND, `No such folder: ${srcArg}`);
    if (backend.mode !== 'dynamic') throw new CldshError(CODES.UNSUPPORTED, FIXED_FOLDER_MOVE, { hint: FIXED_FOLDER_HINT });

    const into = explicitFolder || await backend.folderExists(tgt);
    const to = into ? join(tgt, baseName(src)) : tgt;
    if (!to) throw usageError('A folder cannot replace the root folder');
    if (to === src) throw usageError(`Source and target are the same: ${display(src)}`);
    if (isWithin(to, src)) throw usageError(`Cannot move folder ${display(src)} into itself`);
    const parent = parentOf(to);
    if (parent !== parentOf(src)) await backend.requireFolder(parent, display(parent));
    const targetExists = into ? await backend.folderExists(to) : false;
    if (targetExists) {
      throw new CldshError(CODES.CONFLICT, `Folder already exists: ${display(to)}`, {
        hint: 'Folders cannot be merged; choose another name or move the assets individually.',
      });
    }
    return { kind: 'folder', ...base, from: src, to, urlChanged: false, targetExists: false };
  }

  const ref = await backend.resolveAsset(cwd, srcArg, { resourceType, deliveryType });
  const into = explicitFolder || tgt === '' || await backend.folderExists(tgt);
  const toFolder = into ? tgt : parentOf(tgt);
  const requested = into ? undefined : cleanName(baseName(tgt), ref);
  if (toFolder !== ref.folder) await backend.requireFolder(toFolder, display(toFolder));

  const keepUrl = backend.mode === 'dynamic' && !changePublicId;
  const newName = keepUrl ? (requested ?? ref.name) : (requested ?? baseName(ref.public_id));
  const newPublicId = keepUrl ? ref.public_id : join(toFolder, newName);
  const finalName = keepUrl || backend.mode === 'fixed' ? newName : (requested ?? ref.name);

  if (toFolder === ref.folder && newPublicId === ref.public_id && finalName === ref.name) {
    throw usageError(`Source and target are the same: ${display(join(ref.folder, ref.name))}`);
  }

  // An existing asset is only replaced when the public IDs collide (same delivery URL): renaming
  // with overwrite replaces it. In dynamic mode without a public ID change, another asset of the same
  // type with the same name in the target folder is a name clash: -o keeps both assets.
  let replaces = [];
  let sameName = [];
  if (newPublicId !== ref.public_id) {
    const hit = await publicIdExists(backend, newPublicId, ref);
    if (hit && hit.asset_id !== ref.asset_id) replaces = [hit];
  } else {
    const { assets } = await backend.listAssets(toFolder, { resourceTypes: [ref.resource_type], deliveryTypes: [ref.type] });
    sameName = assets
      .filter(a => a.asset_id !== ref.asset_id && a.name === finalName)
      .map(a => ({ asset_id: a.asset_id, public_id: a.public_id, resource_type: a.resource_type, type: a.type }));
  }
  const from = join(ref.folder, ref.name);
  const to = join(toFolder, finalName);
  if (replaces.length && !overwrite) {
    throw new CldshError(CODES.CONFLICT, `Target already exists: ${display(to)} (public ID ${newPublicId})`, {
      hint: 'Use -o/--overwrite to replace it.',
      details: replaces,
    });
  }
  if (sameName.length && !overwrite) {
    throw new CldshError(CODES.CONFLICT, `An asset named ${display(to)} already exists`, {
      hint: 'Use -o/--overwrite to move anyway; both assets are kept under the same name.',
      details: sameName,
    });
  }

  return {
    kind: 'asset',
    ...base,
    from,
    to,
    urlChanged: newPublicId !== ref.public_id,
    targetExists: replaces.length > 0 || sameName.length > 0,
    replaces,
    sameName,
    changePublicId: !keepUrl,
    public_id: { from: ref.public_id, to: newPublicId },
    folder: { from: ref.folder, to: toFolder },
    name: { from: ref.name, to: finalName },
    ref,
  };
}

/** Carry out a plan from planMove. Nothing is deleted except by a public ID rename with overwrite. */
export async function executeMove(backend, plan) {
  if (plan.kind === 'folder') {
    await backend.renameFolder(plan.from, plan.to);
    return { kind: 'folder', from: plan.from, to: plan.to, urlChanged: false };
  }

  const { ref } = plan;
  const newName = plan.changePublicId ? baseName(plan.public_id.to) : plan.name.to;
  let { after } = await backend.moveAsset(ref, {
    toFolder: plan.folder.to,
    newName,
    changePublicId: plan.changePublicId,
    overwrite: plan.overwrite,
  });
  // Dynamic mode with a new public ID: the rename keeps the old display name; set the new one too.
  if (backend.mode === 'dynamic' && plan.changePublicId && plan.name.to !== plan.name.from) {
    ({ after } = await backend.moveAsset({ ...after, folder: plan.folder.to, name: plan.name.from }, { newName: plan.name.to }));
  }
  return {
    kind: 'asset',
    from: plan.from,
    to: plan.to,
    urlChanged: plan.urlChanged,
    public_id: { from: ref.public_id, to: after.public_id },
    resource_type: ref.resource_type,
    type: ref.type,
    folder: after.folder,
    name: after.name,
    secure_url: after.secure_url,
    replaced: plan.replaces.map(r => r.public_id),
    sameName: plan.sameName.map(r => r.public_id),
    ...(plan.sameName.length ? { warning: `/${plan.folder.to} now has ${plan.sameName.length + 1} assets named "${plan.name.to}"; use the public ID or asset_id:<id> to tell them apart.` } : {}),
  };
}
