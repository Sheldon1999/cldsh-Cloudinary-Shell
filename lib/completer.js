// Tab completion for the interactive shell: command names, the flags of the command being typed
// (from its spec), and remote paths relative to the current folder (nested, e.g. `cd apps/<Tab>`),
// with asset names for commands that take assets. Listings come from the backend's shared cache.
import { GLOBAL_FLAGS } from './parse.js';
import { resolveRemote } from './paths.js';

const FOLDER_COMMANDS = new Set(['cd', 'mkdir', 'tree', 'ls']);
const ASSET_COMMANDS = new Set(['info', 'url', 'view', 'open', 'download', 'rm', 'mv']);
const REPL_WORDS = ['exit', 'quit'];

const escapeWord = (s) => s.replace(/([\s\\"'])/g, '\\$1');
const unescapeWord = (s) => s.replace(/\\(.)/g, '$1');

/** The word under the cursor (backslash-escaped spaces stay inside it) and the tokens before it. */
function splitLine(line) {
  let i = line.length;
  while (i > 0 && !(/\s/.test(line[i - 1]) && line[i - 2] !== '\\')) i--;
  const word = line.slice(i);
  const before = line.slice(0, i).trim();
  return { word, previous: before ? before.split(/(?<!\\)\s+/) : [] };
}

function flagDefs(spec) {
  return { ...GLOBAL_FLAGS, ...(spec?.flags || {}) };
}

function flagCandidates(word, spec) {
  const defs = flagDefs(spec);
  const eq = word.indexOf('=');
  if (word.startsWith('--') && eq !== -1) {
    const def = defs[word.slice(2, eq)];
    return (def?.values || []).map(v => `${word.slice(0, eq)}=${v}`);
  }
  const out = [];
  for (const [name, def] of Object.entries(defs)) {
    out.push(def.type === 'boolean' ? `--${name}` : `--${name}=`);
    if (def.short) out.push(`-${def.short}`);
  }
  return out;
}

/**
 * Decide what the word under the cursor is.
 * @param {string} line text before the cursor
 * @param {Map<string, object>} commands registry (name or alias -> module with `spec`)
 * @param {string} cwd current remote folder
 * @returns {{ kind: 'command'|'flag'|'value'|'path'|'none', word: string, spec?: object,
 *   folder?: string, dirPart?: string, assets?: boolean }}
 *   For `path`, `folder` is the remote folder to list and `dirPart` the typed prefix to keep.
 */
export function completionContext(line, commands, cwd = '') {
  const { word, previous } = splitLine(line);
  if (!previous.length) return { kind: 'command', word };
  const spec = commands.get(previous[0])?.spec;
  if (!spec) return { kind: 'none', word };

  const defs = flagDefs(spec);
  const prev = previous.length > 1 ? previous[previous.length - 1] : '';
  let valueFlag = null;
  if (/^--[^=]+$/.test(prev) && defs[prev.slice(2)] && defs[prev.slice(2)].type !== 'boolean') valueFlag = defs[prev.slice(2)];
  if (/^-[^-]$/.test(prev)) {
    const def = Object.values(defs).find(d => d.short === prev[1]);
    if (def && def.type !== 'boolean') valueFlag = def;
  }

  let typed = word;
  let keep = '';
  if (valueFlag) {
    if (valueFlag.values) return { kind: 'value', word, values: valueFlag.values };
    if (valueFlag.placeholder !== 'folder') return { kind: 'none', word };
  } else if (word.startsWith('-')) {
    const m = /^--([^=]+)=/.exec(word);
    if (!m || defs[m[1]]?.placeholder !== 'folder') return { kind: 'flag', word, spec };
    keep = m[0];
    typed = word.slice(keep.length);
  } else if (!FOLDER_COMMANDS.has(spec.name) && !ASSET_COMMANDS.has(spec.name)) {
    return { kind: 'none', word };
  }

  const raw = unescapeWord(typed);
  const slash = raw.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : raw.slice(0, slash + 1);
  return {
    kind: 'path',
    word,
    folder: resolveRemote(cwd, dirPart || '.'),
    dirPart: keep + escapeWord(dirPart),
    assets: !valueFlag && !keep && ASSET_COMMANDS.has(spec.name),
  };
}

/**
 * Pure completion: `[hits, word]` as readline expects.
 * @param {string} line text before the cursor
 * @param {object} opts
 * @param {Map<string, object>} opts.commands command registry
 * @param {string} [opts.cwd]
 * @param {string[]} [opts.folders] subfolder names of the folder the path word points into
 * @param {string[]} [opts.assets] asset names in that folder
 */
export function matchCompletions(line, { commands, cwd = '', folders = [], assets = [] } = {}) {
  const c = completionContext(line, commands, cwd);
  let candidates = [];
  if (c.kind === 'command') candidates = [...new Set([...commands.keys(), ...REPL_WORDS])].sort();
  else if (c.kind === 'flag') candidates = flagCandidates(c.word, c.spec);
  else if (c.kind === 'value') candidates = c.values;
  else if (c.kind === 'path') {
    candidates = [
      ...folders.map(n => `${c.dirPart}${escapeWord(n)}/`),
      ...(c.assets ? [...new Set(assets)].map(n => `${c.dirPart}${escapeWord(n)}`) : []),
    ];
  }
  return [candidates.filter(x => x.startsWith(c.word)), c.word];
}

/**
 * readline completer for the shell.
 * @param {object} opts
 * @param {{ cwd: string }} opts.session
 * @param {() => Promise<import('./backend/index.js').Backend>} opts.getBackend
 * @param {Map<string, object>} opts.commands command registry
 */
export function createCompleter({ session, getBackend, commands }) {
  async function complete(line) {
    const c = completionContext(line, commands, session.cwd);
    if (c.kind !== 'path') return matchCompletions(line, { commands, cwd: session.cwd });
    let folders = [];
    let assets = [];
    try {
      const backend = await getBackend();
      folders = await backend.listFolders(c.folder);
      if (c.assets) assets = (await backend.listAssets(c.folder)).assets.map(a => a.name);
    } catch {
      return [[], c.word];
    }
    return matchCompletions(line, { commands, cwd: session.cwd, folders, assets });
  }

  return function completer(line, callback) {
    complete(line).then(
      (res) => callback(null, res),
      () => callback(null, [[], '']),
    );
  };
}
