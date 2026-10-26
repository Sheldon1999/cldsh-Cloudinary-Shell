// MCP tool catalogue: schemas, annotations and handlers. Handlers call the same action layer as
// the shell commands (lib/actions/*). Remote paths resolve from the root folder.
//
// Destructive tools (delete, move, rename_folder, and uploads that would replace existing assets)
// are two-step unless the server runs with --no-confirm: the first call returns the plan and a
// `confirm_token`; the second call with the same arguments plus the token runs exactly that plan.
import path from 'node:path';
import { CldshError, CODES, usageError } from '../errors.js';
import { resolveRemote } from '../paths.js';
import { RESOURCE_TYPES, DELIVERY_TYPES } from '../backend/index.js';
import { getActiveConfig } from '../env.js';
import { actionList } from '../actions/list.js';
import { actionTree } from '../actions/tree.js';
import { actionInfo } from '../actions/info.js';
import { actionUrl } from '../actions/url.js';
import { planDelete, executeDelete, describePlan } from '../actions/delete.js';
import { planMove, executeMove } from '../actions/move.js';
import { planUpload, executeUpload } from '../actions/upload.js';
import { planDownload, executeDownload } from '../actions/download.js';

const PREVIEW_LIMIT = 20;
const LOOKUP_BATCH = 100;

// ---------------------------------------------------------------- schema pieces

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });

const RESOURCE_TYPE = (what = 'Resource type filter') => ({
  type: 'string',
  enum: ['all', ...RESOURCE_TYPES],
  description: `${what} (default: "all")`,
});
const DELIVERY_TYPE = {
  type: 'string',
  enum: DELIVERY_TYPES,
  description: 'Delivery type (default: "upload")',
};
const DRY_RUN = bool('Only show what would happen; changes nothing and never returns a confirm_token');
const CONFIRM_TOKEN = str('Token from a previous call with the same arguments that returned needs_confirmation; runs exactly that plan');

const object = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

/** Permissive output schema: results are JSON objects whose shape is described in the tool text. */
const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true };

const rtList = (v) => (v && v !== 'all' ? [v] : RESOURCE_TYPES);
const rtOne = (v) => (v && v !== 'all' ? v : undefined);

// ---------------------------------------------------------------- helpers

/** Short, JSON-friendly view of an asset reference for previews. */
const brief = (a) => ({
  public_id: a.public_id,
  resource_type: a.resource_type,
  type: a.type,
  folder: a.folder,
  name: a.name,
  ...(a.bytes !== undefined ? { bytes: a.bytes } : {}),
});

const first = (list, n = PREVIEW_LIMIT) => ({ shown: list.slice(0, n), more: Math.max(0, list.length - n) });

/**
 * Run a destructive operation through the confirmation flow.
 * @param {object} env handler environment
 * @param {object} op { tool, args, backend, plan, preview, summary, execute(plan) }
 */
async function confirmable(env, { tool, args, backend, plan, preview, summary, execute }) {
  if (args.dry_run) return { dry_run: true, cloud: backend.cloudName, plan_summary: summary, plan: preview };
  if (!env.confirmRequired) return execute(plan);
  const token = env.confirm.issue({ tool, account: env.accountKey(backend), args, plan: structuredClone(plan) });
  return {
    needs_confirmation: true,
    cloud: backend.cloudName,
    plan_summary: summary,
    plan: preview,
    confirm_token: token,
    expires_in_seconds: env.confirm.ttlSeconds,
    next_step: `Show this plan to the user. Only if they approve, call ${tool} again with the same arguments plus "confirm_token".`,
  };
}

/** If the call carries a confirm_token (and confirmation is on), return the stored plan. */
function redeemed(env, tool, args, backend) {
  if (!args.confirm_token || args.dry_run || !env.confirmRequired) return null;
  return env.confirm.redeem(args.confirm_token, { tool, account: env.accountKey(backend), args });
}

/** Planned upload items whose public ID already exists (they would be overwritten). */
async function existingUploads(backend, items) {
  const byType = new Map();
  for (const it of items) {
    if (!byType.has(it.resourceType)) byType.set(it.resourceType, []);
    byType.get(it.resourceType).push(it);
  }
  const existing = new Set();
  for (const [resource_type, list] of byType) {
    const ids = [...new Set(list.map(it => it.publicId))];
    for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
      const res = await backend.call(() => backend.sdk.api.resources_by_ids(ids.slice(i, i + LOOKUP_BATCH), { resource_type, type: 'upload' }));
      for (const r of res.resources || []) existing.add(`${resource_type}\0${r.public_id}`);
    }
  }
  return items.filter(it => existing.has(`${it.resourceType}\0${it.publicId}`));
}

const uploadItemView = (it, exists) => ({
  file: it.relPath,
  public_id: it.publicId,
  folder: it.folder,
  resource_type: it.resourceType,
  bytes: it.bytes,
  exists,
});

// ---------------------------------------------------------------- tools

/**
 * @typedef {object} ToolEnv
 * @property {() => Promise<import('../backend/index.js').Backend>} backend
 * @property {ReturnType<import('../sandbox.js').createSandbox>} sandbox
 * @property {ReturnType<import('./confirm.js').createConfirmStore>} confirm
 * @property {boolean} confirmRequired
 * @property {(backend: object) => string} accountKey
 * @property {AbortSignal} signal
 * @property {object} server { readOnly, confirm }
 */

export const TOOLS = [
  {
    name: 'cloudinary_list',
    title: 'List folder',
    description: 'List the subfolders and assets of a Cloudinary folder (paths start at the root), or the matches of a wildcard such as "cld*" or "shots/*.png".',
    inputSchema: object({
      path: str('Folder path or wildcard pattern, from the root (e.g. "portfolio", "cld*", "shots/*.png"; default: root)'),
      resource_type: RESOURCE_TYPE(),
      delivery_type: DELIVERY_TYPE,
      max: { type: 'integer', minimum: 1, description: 'Maximum number of assets to return (default: 200)' },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      return actionList(await env.backend(), {
        cwd: '',
        target: args.path || '',
        resourceTypes: rtList(args.resource_type),
        deliveryTypes: [args.delivery_type || 'upload'],
        max: args.max ?? 200,
      });
    },
  },
  {
    name: 'cloudinary_upload',
    title: 'Upload files',
    description: 'Upload a local file or directory (inside the allowed local directories) into a Cloudinary folder. The resource type follows the file extension unless resource_type is set.',
    confirmNote: 'If the upload would replace existing assets, the first call returns needs_confirmation with a confirm_token instead of uploading.',
    inputSchema: object({
      local_path: str('Local file or directory, relative to the server\'s working directory or absolute', { minLength: 1 }),
      name: str('Name (public ID) for a single file; default: the file name without extension'),
      folder: str('Target Cloudinary folder, from the root (default: root)'),
      recursive: bool('Include subdirectories of local_path, mirrored as subfolders'),
      overwrite: bool('Replace assets that already exist with the same public ID (default: true; false skips them)'),
      resource_type: { type: 'string', enum: ['auto', ...RESOURCE_TYPES], description: 'Force a resource type (default: "auto", by file extension)' },
      dry_run: DRY_RUN,
      confirm_token: CONFIRM_TOKEN,
    }, ['local_path']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async handler(args, env) {
      const backend = await env.backend();
      const overwrite = args.overwrite !== false;
      await env.rootsReady();
      const stored = redeemed(env, 'cloudinary_upload', args, backend);
      if (stored) {
        // The files were checked when the plan was made; check again in case they changed since.
        for (const it of stored.items) {
          const refusal = env.sandbox.check(it.filePath, stored.localPath);
          if (refusal) throw refusal;
        }
        env.signal.throwIfAborted();
        return executeUpload(backend, stored, { overwrite: true });
      }

      env.sandbox.resolve(args.local_path, { mustExist: true });
      const explicit = env.sandbox.absolute(args.local_path);
      const plan = planUpload({
        cwd: '',
        localPath: explicit,
        name: args.name,
        folder: resolveRemote('', args.folder || ''),
        recursive: Boolean(args.recursive),
        resourceType: args.resource_type,
        allowPath: (p) => env.sandbox.allows(p, explicit),
      });
      if (!plan.items.length) throw usageError(`No files to upload in ${args.local_path}`, plan.isDirectory && !args.recursive ? 'set recursive: true to include subdirectories' : undefined);

      const needCheck = Boolean(args.dry_run) || (overwrite && env.confirmRequired);
      const existing = needCheck ? await existingUploads(backend, plan.items) : [];
      env.signal.throwIfAborted();
      const existingSet = new Set(existing);
      const items = plan.items.map(it => uploadItemView(it, needCheck ? existingSet.has(it) : undefined));
      const summary = [
        `Upload ${plan.items.length} file(s) to cloud "${backend.cloudName}" folder /${plan.folder}`,
        existing.length
          ? `  ${existing.length} asset(s) already exist and will be ${overwrite ? 'overwritten' : 'skipped'}:`
          : '  No existing assets are affected.',
        ...existing.slice(0, PREVIEW_LIMIT).map(it => `  ${it.publicId} (${it.resourceType})`),
        ...(existing.length > PREVIEW_LIMIT ? [`  … and ${existing.length - PREVIEW_LIMIT} more`] : []),
      ].join('\n');

      if (args.dry_run) {
        return { dry_run: true, cloud: backend.cloudName, plan_summary: summary, folder: plan.folder, total: plan.items.length, overwrite, existing: existing.length, items };
      }
      const execute = (p) => executeUpload(backend, p, { overwrite });
      if (!existing.length || !overwrite) return execute(plan);
      const { shown, more } = first(items.filter(i => i.exists));
      return confirmable(env, {
        tool: 'cloudinary_upload',
        args,
        backend,
        plan,
        summary,
        preview: { folder: plan.folder, total: plan.items.length, overwrites: existing.length, overwritten: shown, more_overwritten: more },
        execute,
      });
    },
  },
  {
    name: 'cloudinary_get_url',
    title: 'Get delivery URL',
    description: 'Build CDN delivery URLs for assets, optionally with a transformation (e.g. "f_auto,q_auto", "w_800,c_limit").',
    inputSchema: object({
      public_id: str('Asset name, path from the root, public ID, asset_id:<id>, or wildcard pattern', { minLength: 1 }),
      transformation: str('Cloudinary transformation string (e.g. "f_auto,q_auto", "c_fill,w_300,h_300,g_face")'),
      signed: bool('Sign the URL (for authenticated/private assets or strict transformations)'),
      resource_type: RESOURCE_TYPE('Resource type'),
      delivery_type: DELIVERY_TYPE,
    }, ['public_id']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      return actionUrl(await env.backend(), {
        cwd: '',
        targets: [args.public_id],
        transformation: args.transformation,
        signed: Boolean(args.signed),
        deliveryType: args.delivery_type,
        resourceType: rtOne(args.resource_type),
      });
    },
  },
  {
    name: 'cloudinary_info',
    title: 'Asset details',
    description: 'Full metadata of one asset: dimensions, bytes, format, tags, version, created date, URLs.',
    inputSchema: object({
      public_id: str('Asset name, path from the root, public ID or asset_id:<id>', { minLength: 1 }),
      resource_type: RESOURCE_TYPE('Resource type'),
      delivery_type: DELIVERY_TYPE,
    }, ['public_id']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      return actionInfo(await env.backend(), {
        cwd: '',
        target: args.public_id,
        resourceType: rtOne(args.resource_type),
        deliveryType: args.delivery_type,
      });
    },
  },
  {
    name: 'cloudinary_delete',
    title: 'Delete assets or folders',
    description: 'Delete an asset, the matches of a wildcard, or (with recursive) a folder and everything in it.',
    confirmNote: 'The first call returns needs_confirmation with the full plan and a confirm_token; nothing is deleted until the call is repeated with that token.',
    inputSchema: object({
      target: str('Asset name, path from the root, public ID, folder, or wildcard pattern', { minLength: 1 }),
      recursive: bool('Delete folders with everything in them'),
      resource_type: RESOURCE_TYPE(),
      delivery_type: { ...DELIVERY_TYPE, description: 'Delivery type filter (default: "upload"; recursive deletes cover all types)' },
      dry_run: DRY_RUN,
      confirm_token: CONFIRM_TOKEN,
    }, ['target']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      const backend = await env.backend();
      const stored = redeemed(env, 'cloudinary_delete', args, backend);
      if (stored) {
        env.signal.throwIfAborted();
        return executeDelete(backend, stored);
      }
      const plan = await planDelete(backend, {
        cwd: '',
        targets: [args.target],
        recursive: Boolean(args.recursive),
        resourceTypes: rtList(args.resource_type),
        deliveryTypes: args.delivery_type ? [args.delivery_type] : undefined,
      });
      env.signal.throwIfAborted();
      // Nothing matched: report the misses without a token (there is nothing to confirm).
      if (!plan.assets.length && !plan.folders.length && !args.dry_run) return executeDelete(backend, plan);
      const assets = first(plan.assets.map(brief));
      const folders = first(plan.folders);
      return confirmable(env, {
        tool: 'cloudinary_delete',
        args,
        backend,
        plan,
        summary: describePlan(plan, { limit: PREVIEW_LIMIT }).join('\n'),
        preview: {
          cloud: plan.cloud,
          folder_mode: plan.mode,
          targets: plan.targets,
          recursive: plan.recursive,
          root_wide: plan.rootWide,
          totals: plan.totals,
          folders: folders.shown,
          more_folders: folders.more,
          assets: assets.shown,
          more_assets: assets.more,
          missing: plan.missing,
        },
        execute: (p) => executeDelete(backend, p),
      });
    },
  },
  {
    name: 'cloudinary_move',
    title: 'Move or rename',
    description: 'Move or rename an asset, or move a folder (dynamic folder mode). In dynamic folder mode an asset move keeps its URL unless change_public_id is set.',
    confirmNote: 'The first call returns needs_confirmation with the plan and a confirm_token.',
    inputSchema: object({
      source: str('Asset (name, path from the root, public ID, asset_id:<id>) or folder to move', { minLength: 1 }),
      target: str('New path from the root, or an existing folder (end with "/" to force "into folder")', { minLength: 1 }),
      overwrite: bool('Replace an existing asset at the target (default: false)'),
      change_public_id: bool('Dynamic folder mode: also rename the public ID (changes the delivery URL)'),
      resource_type: RESOURCE_TYPE('Resource type'),
      delivery_type: DELIVERY_TYPE,
      dry_run: DRY_RUN,
      confirm_token: CONFIRM_TOKEN,
    }, ['source', 'target']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async handler(args, env) {
      const backend = await env.backend();
      const stored = redeemed(env, 'cloudinary_move', args, backend);
      if (stored) {
        env.signal.throwIfAborted();
        return executeMove(backend, stored);
      }
      const plan = await planMove(backend, {
        cwd: '',
        source: args.source,
        target: args.target,
        changePublicId: Boolean(args.change_public_id),
        overwrite: Boolean(args.overwrite),
        resourceType: rtOne(args.resource_type),
        deliveryType: args.delivery_type,
      });
      env.signal.throwIfAborted();
      const { ref: _ref, ...preview } = plan;
      const summary = [
        `Move ${plan.kind} /${plan.from} -> /${plan.to} on cloud "${backend.cloudName}"`,
        plan.urlChanged ? `  The public ID changes (${plan.public_id.from} -> ${plan.public_id.to}): the delivery URL changes.` : '  The delivery URL stays the same.',
        ...(plan.targetExists ? [`  Replaces the existing asset(s): ${plan.replaces.map(r => r.public_id).join(', ')}`] : []),
      ].join('\n');
      return confirmable(env, {
        tool: 'cloudinary_move', args, backend, plan, preview, summary, execute: (p) => executeMove(backend, p),
      });
    },
  },
  {
    name: 'cloudinary_tree',
    title: 'Folder tree',
    description: 'Folder hierarchy with the assets of each folder, starting at a folder (default: root).',
    inputSchema: object({
      folder: str('Folder to start from, from the root (default: root)'),
      depth: { type: 'integer', minimum: 0, description: 'Maximum depth (default: unlimited; 0 = only the folder itself)' },
      resource_type: RESOURCE_TYPE(),
      max_files: { type: 'integer', minimum: 0, description: 'Maximum assets listed per folder (default: 100)' },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      return actionTree(await env.backend(), {
        cwd: '',
        target: args.folder || '',
        depth: args.depth ?? Infinity,
        resourceTypes: rtList(args.resource_type),
        maxFilesPerDir: args.max_files ?? 100,
      });
    },
  },
  {
    name: 'cloudinary_download',
    title: 'Download assets',
    description: 'Download assets (name, public ID or wildcard) into a local directory or file inside the allowed local directories. Existing files are skipped unless overwrite is true.',
    inputSchema: object({
      public_id: str('Asset name, path from the root, public ID, asset_id:<id>, or wildcard pattern', { minLength: 1 }),
      destination: str('Local directory or file path (default: the server\'s working directory)'),
      overwrite: bool('Replace existing local files (default: false)'),
      resource_type: RESOURCE_TYPE('Resource type'),
      delivery_type: DELIVERY_TYPE,
      dry_run: bool('Only show what would be downloaded where'),
    }, ['public_id']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      const backend = await env.backend();
      await env.rootsReady();
      const dest = args.destination || '.';
      env.sandbox.resolve(dest);
      const explicit = env.sandbox.absolute(dest);
      const plan = await planDownload(backend, {
        cwd: '',
        targets: [args.public_id],
        destination: explicit + (/[/\\]$/.test(dest) ? path.sep : ''),
        resourceType: rtOne(args.resource_type),
        deliveryType: args.delivery_type,
      });
      env.signal.throwIfAborted();
      const allowPath = (p) => env.sandbox.allows(p, explicit);
      if (args.dry_run) {
        return {
          dry_run: true,
          destination: plan.destination,
          overwrite: args.overwrite === true,
          items: plan.items.map(it => {
            const refusal = env.sandbox.check(it.localPath, explicit);
            return { ...it, ...(refusal ? { allowed: false, error: refusal.message } : { allowed: true }) };
          }),
          missing: plan.missing,
        };
      }
      return executeDownload(plan, { overwrite: args.overwrite === true, allowPath });
    },
  },
  {
    name: 'cloudinary_mkdir',
    title: 'Create folder',
    description: 'Create a folder (missing parent folders are created too).',
    inputSchema: object({
      folder: str('Folder path from the root', { minLength: 1 }),
    }, ['folder']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(args, env) {
      const folder = resolveRemote('', args.folder);
      if (!folder) throw usageError('The root folder already exists');
      const backend = await env.backend();
      const res = await backend.createFolder(folder);
      return { created: res.path };
    },
  },
  {
    name: 'cloudinary_rename_folder',
    title: 'Rename folder',
    description: 'Rename or move a folder with everything in it (dynamic folder mode only; asset URLs do not change).',
    confirmNote: 'The first call returns needs_confirmation with the plan and a confirm_token.',
    inputSchema: object({
      from: str('Existing folder path from the root', { minLength: 1 }),
      to: str('New folder path from the root', { minLength: 1 }),
      dry_run: DRY_RUN,
      confirm_token: CONFIRM_TOKEN,
    }, ['from', 'to']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async handler(args, env) {
      const backend = await env.backend();
      const stored = redeemed(env, 'cloudinary_rename_folder', args, backend);
      const run = (p) => backend.renameFolder(p.from, p.to);
      if (stored) {
        env.signal.throwIfAborted();
        return run(stored);
      }
      const from = resolveRemote('', args.from);
      const to = resolveRemote('', args.to);
      if (!from) throw usageError('The root folder cannot be renamed');
      if (!to) throw usageError('A folder cannot replace the root folder');
      if (backend.mode !== 'dynamic') {
        throw new CldshError(CODES.UNSUPPORTED, 'Renaming folders is not supported by Cloudinary in fixed folder mode', {
          hint: 'Move the assets individually, or ask Cloudinary support to migrate the product environment to dynamic folders.',
        });
      }
      await backend.requireFolder(from, `/${from}`);
      if (await backend.folderExists(to)) throw new CldshError(CODES.CONFLICT, `Folder already exists: /${to}`, { hint: 'Folders cannot be merged; choose another name.' });
      const plan = { cloud: backend.cloudName, from, to };
      return confirmable(env, {
        tool: 'cloudinary_rename_folder',
        args,
        backend,
        plan,
        preview: plan,
        summary: `Rename folder /${from} -> /${to} on cloud "${backend.cloudName}" (asset URLs stay the same)`,
        execute: run,
      });
    },
  },
  {
    name: 'cloudinary_account',
    title: 'Account and server status',
    description: 'The connected Cloudinary account (cloud name, folder mode, where the credentials come from, remaining Admin API requests) and this server\'s safety settings.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(_args, env) {
      const backend = await env.backend();
      await backend.ping();
      const cfg = getActiveConfig() || {};
      return {
        cloud_name: backend.cloudName,
        folder_mode: backend.mode,
        credential_source: cfg.source ?? null,
        profile: cfg.profile ?? null,
        rate_limit: backend.rate
          ? { allowed: backend.rate.allowed, remaining: backend.rate.remaining, reset_at: backend.rate.resetAt }
          : null,
        server: {
          read_only: env.server.readOnly,
          confirmation: env.confirmRequired ? 'two-step' : 'off',
          allowed_local_paths: env.sandbox.roots,
        },
      };
    },
  },
];

export const TOOL_NAMES = TOOLS.map(t => t.name);
export { OUTPUT_SCHEMA };
