// Runs one command for the shell or the headless CLI: parse against the command's flag schema,
// build the per-invocation context, run, print (JSON or human), and map the outcome to an exit code.
import process from 'node:process';
import { COMMANDS } from '../commands/index.js';
import { parseArgs, suggest } from './parse.js';
import { EXIT, toCldError, usageError, formatError } from './errors.js';
import { getActiveConfig, loadEnvAndConfig } from './env.js';
import { getBackend, peekBackend, setFolderModeOverride } from './backend/index.js';

/**
 * Session state shared by every command of one shell (or one headless run).
 * @param {'repl' | 'headless' | 'mcp'} mode
 */
export function createSession(mode) {
  let cwd = '';
  let prevCwd = '';
  return {
    mode,
    get cwd() { return cwd; },
    get prevCwd() { return prevCwd; },
    setCwd(next) { prevCwd = cwd; cwd = next; },
  };
}

/** Build the context object handed to a command's `run`. */
export function createContext(session, { out, prompter, flags = {} }) {
  let exitCode = EXIT.OK;
  return {
    session,
    get cwd() { return session.cwd; },
    out,
    prompter,
    flags,
    /** True when the user can answer questions (shell, or headless run on a terminal). */
    get interactive() { return Boolean(prompter?.interactive); },
    account: () => getActiveConfig(),
    backend: () => getBackend(getActiveConfig()),
    /** Mark the invocation as e.g. partially failed while still returning its result. */
    setExitCode(code) { exitCode = Math.max(exitCode, code); },
    get exitCode() { return exitCode; },
  };
}

export function lookupCommand(name) {
  const mod = COMMANDS.get(name);
  if (mod) return mod;
  const hint = suggest(name, [...COMMANDS.keys()]);
  throw usageError(`Unknown command: ${name}`, hint ? `did you mean "${hint}"?` : 'run "help" for the list of commands');
}

/**
 * Run `tokens` (command name first). Never throws: errors are printed and returned as an exit code.
 * @returns {Promise<number>} exit code
 */
export async function dispatch(session, tokens, { out, prompter }) {
  let flags = {};
  try {
    const [name, ...rest] = tokens;
    const mod = lookupCommand(name);
    const parsed = parseArgs(rest, mod.spec);
    flags = parsed.flags;
    out.json = Boolean(flags.json);

    if (flags.help) {
      const helpMod = COMMANDS.get('help');
      const result = await helpMod.default(createContext(session, { out, prompter, flags }), [mod.spec.name], {});
      helpMod.render(result, { out });
      return EXIT.OK;
    }

    if (flags.profile !== undefined) {
      if (session.mode === 'repl') throw usageError('--profile only applies to single commands', 'inside the shell, switch accounts with "config use <profile>"');
      loadEnvAndConfig({ profileName: String(flags.profile) });
    }
    if (flags['folder-mode']) setFolderModeOverride(flags['folder-mode']);

    const ctx = createContext(session, { out, prompter, flags });
    const result = await mod.default(ctx, parsed.args, flags);
    if (result !== undefined) {
      if (flags.json) out.data(result);
      else mod.render?.(result, ctx);
    }
    const b = peekBackend();
    if (b?.rateLow) out.warn(`Only ${b.rate.remaining} of ${b.rate.allowed} Admin API requests left this hour (resets ${b.rate.resetAt}).`);
    return ctx.exitCode;
  } catch (e) {
    const err = toCldError(e);
    if (flags.json || out.json) {
      process.stderr.write(JSON.stringify({ error: err.toJSON() }) + '\n');
    } else {
      out.error(formatError(err));
      if (Array.isArray(err.details)) {
        for (const d of err.details.slice(0, 10)) out.error(`  ${typeof d === 'string' ? d : JSON.stringify(d)}`);
      }
    }
    return err.exitCode;
  }
}
