import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Normalize a remote path: forward slashes, no leading/trailing slash, no empty segments. */
export const norm = (p = '') => String(p ?? '').replace(/\\/g, '/').split('/').filter(Boolean).join('/');

/** Join remote path segments. */
export const join = (...parts) => norm(parts.map(norm).filter(Boolean).join('/'));

export const parentOf = (p = '') => {
  const n = norm(p);
  return n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '';
};

export const baseName = (p = '') => norm(p).split('/').pop() || '';

export const isWithin = (p, root) => {
  const a = norm(p);
  const r = norm(root);
  return r === '' || a === r || a.startsWith(r + '/');
};

/**
 * Resolve a remote (Cloudinary) path argument against the current folder.
 * - relative paths resolve against `cwd`
 * - a leading `/` or `~` means the root
 * - `.` and `..` are normalized; `..` at the root stays at the root
 * Every command and MCP tool resolves remote arguments through this function.
 */
export function resolveRemote(cwd = '', target = '') {
  const t = String(target ?? '').trim();
  if (!t || t === '~' || t === '/') return '';
  const absolute = t.startsWith('/') || t === '~' || t.startsWith('~/');
  const segments = [
    ...(absolute ? [] : norm(cwd).split('/')),
    ...t.replace(/^~(?=\/|$)/, '').split('/'),
  ].filter(Boolean);
  const out = [];
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Resolve a local filesystem path (supports `~`). */
export function resolveLocal(p = '') {
  const s = String(p ?? '');
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2));
  return path.resolve(process.cwd(), s);
}
