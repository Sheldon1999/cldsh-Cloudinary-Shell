// Guard for headless runs: an unquoted wildcard such as `cldsh rm -rf *` is expanded by the
// user's shell into local file names before cldsh sees it, which would then delete cloud
// assets or folders that happen to share those names.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { COMMANDS } from '../commands/index.js';
import { parseArgs } from './parse.js';
import { EXIT } from './errors.js';

const GUARDED = new Set(['rm']);

/**
 * @returns {number | null} an exit code when the run is refused, otherwise null
 */
export function warnShellExpansion(tokens, out, cwd = process.cwd()) {
  const [name, ...rest] = tokens;
  const mod = COMMANDS.get(name);
  if (!mod || !GUARDED.has(mod.spec.name)) return null;
  let parsed;
  try {
    parsed = parseArgs(rest, mod.spec);
  } catch {
    return null; // the dispatcher reports the usage error
  }
  const { args, flags } = parsed;
  if (flags.yes || args.length < 2) return null;
  if (args.some(a => /[*?]/.test(a))) return null;
  const allLocal = args.every(a => fs.existsSync(path.resolve(cwd, a)));
  if (!allLocal) return null;
  out.error(`Refusing to run "${name}" on ${args.length} names that all exist in the local directory ${cwd}.`);
  out.error('Your shell probably expanded a wildcard before cldsh received it.');
  out.error(`  hint: quote the pattern, e.g. cldsh ${name} ${flags.recursive ? '-rf ' : ''}'*', or add --yes if you really mean these names.`);
  return EXIT.USAGE;
}
