// Command-line parsing driven by per-command flag schemas (see `spec` in commands/*.js).
//
// A flag definition: { type: 'boolean' | 'string' | 'number', short?: 'r', alias?: ['recursive'],
//                      values?: [...allowed], negatable?: true, description, placeholder }
// Knowing which flags take values is what lets `rm -r folder` keep `folder` positional
// while `tree -d 2` reads 2 as the depth.
import { usageError } from './errors.js';

/** Flags accepted by every command. */
export const GLOBAL_FLAGS = {
  json: { type: 'boolean', description: 'Print machine-readable JSON on stdout' },
  help: { type: 'boolean', short: 'h', description: 'Show help for the command' },
  profile: { type: 'string', placeholder: 'name', description: 'Use a saved credentials profile for this run' },
  'folder-mode': { type: 'string', values: ['fixed', 'dynamic'], description: 'Override folder-mode detection' },
};

/**
 * Split a shell-like line into tokens. Supports "double" and 'single' quotes and backslash escapes
 * (outside single quotes). Quotes may appear inside a token: --t="a b" becomes `--t=a b`.
 */
export function tokenize(line = '') {
  const tokens = [];
  let cur = '';
  let inToken = false;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < line.length && (line[i + 1] === '"' || line[i + 1] === '\\')) {
        cur += line[++i];
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; inToken = true; continue; }
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; inToken = true; continue; }
    if (/\s/.test(ch)) {
      if (inToken) { tokens.push(cur); cur = ''; inToken = false; }
      continue;
    }
    cur += ch;
    inToken = true;
  }
  if (quote) throw usageError(`Unterminated ${quote} quote`);
  if (inToken) tokens.push(cur);
  return tokens;
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function suggest(word, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(word, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

function buildIndex(flagDefs) {
  const long = new Map();
  const short = new Map();
  for (const [name, def] of Object.entries(flagDefs)) {
    long.set(name, name);
    for (const a of def.alias || []) long.set(a, name);
    if (def.short) short.set(def.short, name);
  }
  return { long, short };
}

function coerce(name, def, raw) {
  if (def.type === 'number') {
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) throw usageError(`--${name} expects a number, got "${raw}"`);
    return n;
  }
  if (def.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw usageError(`--${name} is a switch; use --${name} or --no-${name}`);
  }
  if (def.values && !def.values.includes(raw)) {
    throw usageError(`--${name} must be one of: ${def.values.join(', ')} (got "${raw}")`);
  }
  return raw;
}

/**
 * Parse tokens (after the command name) against a command spec.
 * @returns {{ args: string[], flags: Record<string, any> }}
 */
export function parseArgs(tokens, spec = {}) {
  const flagDefs = { ...GLOBAL_FLAGS, ...(spec.flags || {}) };
  const { long, short } = buildIndex(flagDefs);
  const args = [];
  const flags = {};
  const cmd = spec.name ? `${spec.name}: ` : '';

  const unknown = (display) => {
    const names = [...long.keys()].map(n => `--${n}`).concat([...short.keys()].map(s => `-${s}`));
    const hint = suggest(display, names);
    return usageError(`${cmd}unknown option ${display}`, hint ? `did you mean ${hint}?` : `run "help ${spec.name || ''}" for options`);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') { args.push(...tokens.slice(i + 1)); break; }

    if (t.startsWith('--') && t.length > 2) {
      const eq = t.indexOf('=');
      let key = eq === -1 ? t.slice(2) : t.slice(2, eq);
      let negated = false;
      if (!long.has(key) && key.startsWith('no-') && long.has(key.slice(3))) {
        key = key.slice(3);
        negated = true;
      }
      const name = long.get(key);
      if (!name) throw unknown(`--${key}`);
      const def = flagDefs[name];
      if (negated) {
        if (def.type !== 'boolean') throw usageError(`${cmd}--no-${key} is not valid; --${key} takes a value`);
        flags[name] = false;
        continue;
      }
      if (def.type === 'boolean') {
        flags[name] = eq === -1 ? true : coerce(name, def, t.slice(eq + 1));
        continue;
      }
      if (eq !== -1) { flags[name] = coerce(name, def, t.slice(eq + 1)); continue; }
      if (i + 1 >= tokens.length) throw usageError(`${cmd}--${key} needs a value`);
      flags[name] = coerce(name, def, tokens[++i]);
      continue;
    }

    if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) {
      const body = t.slice(1);
      const eq = body.indexOf('=');
      const letters = eq === -1 ? body : body.slice(0, eq);
      for (let j = 0; j < letters.length; j++) {
        const name = short.get(letters[j]);
        if (!name) throw unknown(`-${letters[j]}`);
        const def = flagDefs[name];
        if (def.type === 'boolean') { flags[name] = true; continue; }
        // A value flag must be the last letter of a cluster: -d 2, -d2, -d=2
        const rest = letters.slice(j + 1);
        if (eq !== -1 && j === letters.length - 1) flags[name] = coerce(name, def, body.slice(eq + 1));
        else if (rest) flags[name] = coerce(name, def, rest);
        else if (i + 1 < tokens.length) flags[name] = coerce(name, def, tokens[++i]);
        else throw usageError(`${cmd}-${letters[j]} needs a value`);
        break;
      }
      continue;
    }

    args.push(t);
  }

  for (const [name, def] of Object.entries(flagDefs)) {
    if (flags[name] === undefined && def.default !== undefined) flags[name] = def.default;
  }
  return { args, flags };
}
