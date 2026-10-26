// Local filesystem sandbox for the MCP server. An AI agent controls the tool arguments, so the
// upload source and download destination are restricted:
// - only paths inside the allowed roots (server working directory, the client's MCP roots,
//   --allow-path directories) are reachable;
// - paths are compared after realpath, so symlinks can't escape a root;
// - the cldsh config directory (credentials) and ~/.ssh are always refused;
// - dotfiles and dot-directories are refused unless the argument itself names them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { CldshError, CODES } from './errors.js';
import { getConfigDir } from './credentials.js';

/** Expand `~` and make absolute (relative to `base`), without touching the filesystem. */
function absolutize(p, base, home) {
  const s = String(p ?? '');
  if (s === '~') return home;
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(home, s.slice(2));
  return path.resolve(base, s);
}

/**
 * Realpath of `abs`; for a path that doesn't exist yet, the realpath of its nearest existing
 * ancestor plus the missing tail (missing segments can't be symlinks).
 */
export function realpathLoose(abs) {
  let cur = path.resolve(abs);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const parent = path.dirname(cur);
      if (parent === cur) return path.join(cur, ...tail);
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

const inside = (p, dir) => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Both the literal and the resolved form of a directory (it may not exist, or be a symlink). */
function forms(dir) {
  const abs = path.resolve(dir);
  const real = realpathLoose(abs);
  return real === abs ? [abs] : [abs, real];
}

/**
 * @param {object} [opts]
 * @param {string} [opts.base] directory relative paths resolve against (default: process.cwd())
 * @param {string[]} [opts.roots] initial roots (default: [base])
 * @param {string} [opts.home] home directory (default: os.homedir())
 * @param {string} [opts.configDir] cldsh config directory (default: getConfigDir())
 */
export function createSandbox({ base = process.cwd(), roots, home = os.homedir(), configDir = getConfigDir() } = {}) {
  const staticRoots = new Set();
  let clientRoots = [];
  const forbidden = [
    { dirs: forms(configDir), what: 'the cldsh configuration directory' },
    { dirs: forms(path.join(home, '.ssh')), what: '~/.ssh' },
  ];

  const toRoot = (dir) => {
    const real = realpathLoose(absolutize(dir, base, home));
    return fs.existsSync(real) && fs.statSync(real).isDirectory() ? real : null;
  };

  for (const r of roots ?? [base]) {
    const real = toRoot(r);
    if (real) staticRoots.add(real);
  }

  const allRoots = () => [...new Set([...staticRoots, ...clientRoots])];

  function refusal(real, display, why) {
    const list = allRoots();
    return new CldshError(CODES.FORBIDDEN, `Access to ${display} is not allowed: ${why}`, {
      hint: why.startsWith('outside')
        ? `Allowed directories: ${list.join(', ') || '(none)'}. Start the server with --allow-path <dir> to allow more.`
        : undefined,
      details: { path: real },
    });
  }

  /**
   * Check an absolute path. `explicit` is the argument the caller typed (absolute, before
   * realpath): dot segments are only allowed when that argument names them.
   * @returns {{ ok: true, real: string } | { ok: false, error: CldshError }}
   */
  function inspect(abs, { explicit = abs, display = abs } = {}) {
    const real = realpathLoose(abs);
    for (const f of forbidden) {
      if (f.dirs.some(d => inside(real, d) || inside(abs, d))) return { ok: false, error: refusal(real, display, `it is inside ${f.what}`) };
    }
    const root = allRoots().filter(r => inside(real, r)).sort((a, b) => b.length - a.length)[0];
    if (!root) return { ok: false, error: refusal(real, display, 'outside the allowed directories') };
    const named = new Set(path.resolve(explicit).split(path.sep));
    const hidden = path.relative(root, real).split(path.sep).find(seg => seg.startsWith('.') && seg !== '.' && seg !== '..' && !named.has(seg));
    if (hidden) return { ok: false, error: refusal(real, display, `"${hidden}" is a hidden file or directory (name it explicitly to use it)`) };
    return { ok: true, real };
  }

  return {
    /** Directory relative paths resolve against. */
    base,
    /** Absolute form of a tool argument (`~` expanded), without resolving symlinks. */
    absolute(arg) {
      return absolutize(arg, base, home);
    },
    /** Allowed roots (realpaths). */
    get roots() { return allRoots(); },
    addRoot(dir) {
      const real = toRoot(dir);
      if (!real) throw new CldshError(CODES.USAGE, `--allow-path: not a directory: ${dir}`);
      staticRoots.add(real);
      return real;
    },
    /** Replace the roots provided by the MCP client (absolute paths). */
    setClientRoots(dirs) {
      clientRoots = dirs.map(toRoot).filter(Boolean);
    },
    /**
     * Resolve a tool argument to an allowed real path, or throw FORBIDDEN / NOT_FOUND.
     * @param {string} arg path as given (relative to `base`, `~` allowed)
     * @param {{ mustExist?: boolean }} [opts]
     */
    resolve(arg, { mustExist = false } = {}) {
      const abs = absolutize(arg, base, home);
      const res = inspect(abs, { display: String(arg) });
      if (!res.ok) throw res.error;
      if (mustExist && !fs.existsSync(res.real)) throw new CldshError(CODES.NOT_FOUND, `No such local file or directory: ${arg}`);
      return res.real;
    },
    /**
     * Predicate for paths derived from an argument (files found in a directory, download
     * targets): `explicit` is the resolved argument they came from.
     */
    allows(abs, explicit) {
      return inspect(abs, { explicit: explicit ?? abs }).ok;
    },
    /** Like `allows`, but returns the refusal error (or null). */
    check(abs, explicit) {
      const res = inspect(abs, { explicit: explicit ?? abs });
      return res.ok ? null : res.error;
    },
  };
}
