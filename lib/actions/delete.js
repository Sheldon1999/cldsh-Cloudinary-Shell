// Deletes are planned first and executed second, so the shell can preview and confirm exactly
// what will be removed (and the MCP server can hand out a token for that plan).
//
// Recursive deletes list the whole subtree through the backend (asset folder in dynamic mode,
// public ID path in fixed mode), delete the assets by asset ID, then delete the emptied folders.
// Deleting by public ID prefix is never used: in dynamic mode it can hit assets in other folders.
import { isGlob, parseGlobTarget } from '../glob.js';
import { resolveRemote, join, isWithin } from '../paths.js';
import { RESOURCE_TYPES, DELIVERY_TYPES } from '../backend/index.js';
import { CODES, usageError } from '../errors.js';
import { formatBytes } from '../printer.js';

const refKey = (r) => r.asset_id || `${r.resource_type}/${r.type}/${r.public_id}`;

/** Narrow the resolveAsset lookup only when exactly one type was asked for. */
const single = (list, all) => (list && list.length === 1 && list.length < all.length ? list[0] : undefined);

/**
 * Build the complete list of what a delete would remove. Nothing is changed.
 * @returns {Promise<{ cloud: string, mode: string, targets: string[], recursive: boolean, assets: object[],
 *   folders: string[], missing: { target: string, path: string, reason: string }[],
 *   totals: { assets: number, folders: number, bytes: number, byResourceType: object, byDeliveryType: object },
 *   rootWide: boolean }>}
 */
export async function planDelete(backend, { cwd = '', targets = [], recursive = false, resourceTypes = RESOURCE_TYPES, deliveryTypes } = {}) {
  const list = (Array.isArray(targets) ? targets : [targets]).map(t => String(t ?? '').trim()).filter(Boolean);
  if (!list.length) throw usageError('Nothing to delete: give an asset name, folder or pattern');
  const rts = resourceTypes?.length ? resourceTypes : RESOURCE_TYPES;
  // Recursive deletes cover every delivery type by default, so emptied folders can be removed.
  const types = deliveryTypes?.length ? deliveryTypes : (recursive ? DELIVERY_TYPES : ['upload']);
  // A folder is only deleted when nothing in it is filtered out; otherwise it would never be empty.
  const unfiltered = RESOURCE_TYPES.every(t => rts.includes(t)) && DELIVERY_TYPES.every(t => types.includes(t));

  const assets = new Map();
  const folders = [];
  const missing = [];
  let rootWide = false;
  const addAssets = (refs) => { for (const r of refs) if (!assets.has(refKey(r))) assets.set(refKey(r), r); };
  const addSubtree = async (folder) => {
    addAssets(await backend.listSubtree(folder, { resourceTypes: rts, deliveryTypes: types }));
    if (!unfiltered) return;
    if (folder) folders.push(folder);
    else folders.push(...(await backend.listFolders('')).map(n => join('', n)));
  };

  for (const target of list) {
    if (isGlob(target)) {
      let found;
      try {
        found = await backend.findByGlob(cwd, target, { resourceTypes: rts, deliveryTypes: types, includeFolders: recursive });
      } catch (e) {
        if (e.code !== CODES.NOT_FOUND) throw e;
        missing.push({ target, path: target, reason: e.message });
        continue;
      }
      if (recursive && !found.folder && /^\*+$/.test(parseGlobTarget(cwd, target).filePattern)) rootWide = true;
      addAssets(found.assets);
      for (const f of found.folders) await addSubtree(f);
      if (!found.assets.length && !found.folders.length) missing.push({ target, path: target, reason: 'No matches' });
      continue;
    }

    const path = resolveRemote(cwd, target);
    if (recursive && (!path || await backend.folderExists(path))) {
      if (!path) rootWide = true;
      await addSubtree(path);
      continue;
    }
    if (!path) throw usageError(`"${target}" is the root folder`, `use "rm -r ${target}" to delete everything in it`);

    try {
      addAssets([await backend.resolveAsset(cwd, target, { resourceType: single(rts, RESOURCE_TYPES), deliveryType: single(deliveryTypes, DELIVERY_TYPES) })]);
    } catch (e) {
      if (e.code !== CODES.NOT_FOUND) throw e;
      if (!recursive && await backend.folderExists(path)) {
        throw usageError(`"${target}" is a folder`, `use "rm -r ${target}" to delete it with everything in it`);
      }
      missing.push({ target, path, reason: e.message });
    }
  }

  // Drop folders inside other planned folders: deleting the top one removes its descendants.
  const unique = [...new Set(folders)];
  const topFolders = unique.filter(f => !unique.some(o => o !== f && isWithin(f, o)));

  const refs = [...assets.values()];
  const byResourceType = {};
  const byDeliveryType = {};
  let bytes = 0;
  for (const r of refs) {
    byResourceType[r.resource_type] = (byResourceType[r.resource_type] || 0) + 1;
    byDeliveryType[r.type] = (byDeliveryType[r.type] || 0) + 1;
    bytes += Number(r.bytes) || 0;
  }

  return {
    cloud: backend.cloudName,
    mode: backend.mode,
    targets: list,
    recursive: Boolean(recursive),
    assets: refs,
    folders: topFolders,
    missing,
    totals: { assets: refs.length, folders: topFolders.length, bytes, byResourceType, byDeliveryType },
    rootWide,
  };
}

const itemOf = (ref, status, error) => ({
  public_id: ref.public_id,
  resource_type: ref.resource_type,
  type: ref.type,
  asset_id: ref.asset_id,
  path: join(ref.folder, ref.name),
  status,
  ...(error ? { error } : {}),
});

/**
 * Run a plan from planDelete. Every asset and folder gets its own status; nothing is reported as
 * deleted unless the API said so.
 */
export async function executeDelete(backend, plan, { skipBackup = false } = {}) {
  const items = (plan.missing || []).map(m => ({
    public_id: m.path, resource_type: null, type: null, target: m.target, status: 'not_found', error: m.reason,
  }));
  const results = plan.assets.length ? await backend.deleteAssets(plan.assets) : [];
  for (const r of results) items.push(itemOf(r.ref, r.status, r.error));

  const folders = [];
  for (const path of plan.folders) {
    const left = results.filter(r => r.status === 'failed' && isWithin(r.ref.folder, path)).length;
    if (left) {
      folders.push({ path, status: 'failed', error: `${left} asset(s) in it could not be deleted` });
      continue;
    }
    try {
      await backend.deleteFolder(path, { skipBackup });
      folders.push({ path, status: 'deleted' });
    } catch (e) {
      if (e.code === CODES.NOT_FOUND) {
        // Already gone (fixed-mode folders vanish with their last asset).
        folders.push({ path, status: 'deleted' });
        continue;
      }
      const entry = { path, status: 'failed', error: e.message };
      if (!skipBackup && /not empty/i.test(e.message)) {
        entry.hint = 'If it only holds backed-up versions of deleted assets, retry with --skip-backup.';
      }
      folders.push(entry);
    }
  }

  const count = (list, s) => list.filter(i => i.status === s).length;
  return {
    items,
    folders,
    summary: {
      deleted: count(items, 'deleted'),
      not_found: count(items, 'not_found'),
      failed: count(items, 'failed'),
      folders_deleted: count(folders, 'deleted'),
      folders_failed: count(folders, 'failed'),
    },
  };
}

/** Human summary of a plan: counts, cloud, the first `limit` folders and assets, missing targets. */
export function describePlan(plan, { limit = 10 } = {}) {
  const { totals } = plan;
  const kinds = Object.entries(totals.byResourceType).map(([k, n]) => `${n} ${k}`).join(', ');
  const lines = [
    `Delete ${totals.assets} asset(s)${kinds ? ` (${kinds}; ${formatBytes(totals.bytes)})` : ''} and ${totals.folders} folder(s) on cloud "${plan.cloud}":`,
  ];
  if (plan.rootWide) lines.push('  This empties the whole account (everything under the root folder).');
  const entries = [
    ...plan.folders.map(f => `  folder ${f}/ (with everything in it)`),
    ...plan.assets.map(a => `  ${join(a.folder, a.name)}${a.format && !a.name.endsWith(`.${a.format}`) ? `.${a.format}` : ''} (${a.resource_type}/${a.type})`),
  ];
  lines.push(...entries.slice(0, limit));
  if (entries.length > limit) lines.push(`  … and ${entries.length - limit} more`);
  for (const m of plan.missing || []) lines.push(`  not found: ${m.target}`);
  return lines;
}
