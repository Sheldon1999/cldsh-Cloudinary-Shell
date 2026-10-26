// Entry point: picks the mode (MCP server, headless command, interactive shell).
import readline from 'node:readline';
import process from 'node:process';
import { VERSION } from './version.js';
import { EXIT } from './errors.js';
import { createOutput } from './output.js';
import { createPrompter } from './prompt.js';
import { createSession, dispatch } from './cli.js';
import { tokenize } from './parse.js';
import { loadEnvAndConfig, getActiveConfig, onCredentialsChange } from './env.js';
import { resetBackend, getBackend } from './backend/index.js';
import { createCompleter } from './completer.js';
import { loadHistory, recordHistory, pruneHistory } from './history.js';
import { COMMANDS } from '../commands/index.js';
import { warnShellExpansion } from './shell-expansion.js';

onCredentialsChange(() => resetBackend());

export async function main(argv) {
  // `cldsh help | head`: the reader went away; stop quietly instead of crashing.
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw e;
  });
  if (argv.includes('--mcp')) {
    const startup = loadEnvAndConfig();
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer({ session: createSession('mcp'), argv, startup });
    return;
  }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.length > 0) {
    process.exitCode = await runHeadless(argv);
    return;
  }
  await runRepl();
}

async function runHeadless(argv) {
  const tokens = argv[0] === '--help' || argv[0] === '-h' ? ['help', ...argv.slice(1)] : argv;
  loadEnvAndConfig();
  const out = createOutput();
  const prompter = createPrompter();
  const refused = warnShellExpansion(tokens, out);
  if (refused !== null) return refused;
  // Exit by setting process.exitCode (never process.exit): piped stdout must drain completely.
  return dispatch(createSession('headless'), tokens, { out, prompter });
}

function promptText(session, out) {
  const acct = getActiveConfig();
  const tag = acct
    ? out.c.cyan(`[${acct.cloud_name}${acct.profile && !['default', 'env', 'local'].includes(acct.profile) ? `:${acct.profile}` : ''}]`)
    : out.c.dim('[disconnected]');
  return `${tag}$${session.cwd ? `~/${session.cwd}` : '~'} `;
}

async function runRepl() {
  const startup = loadEnvAndConfig();
  const session = createSession('repl');
  const out = createOutput();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: createCompleter({ session, getBackend: () => getBackend(getActiveConfig()), commands: COMMANDS }),
    history: loadHistory(),
    historySize: 1000,
    removeHistoryDuplicates: true,
  });
  const prompter = createPrompter({ rl });
  process.on('exit', () => pruneHistory());

  if (startup.configured) {
    out.print(out.c.dim(`Connected to Cloudinary account: ${out.c.bold(startup.cloud_name)} (${startup.source})`));
  } else {
    out.print(out.c.yellow('No Cloudinary account connected. Run "login", or set CLOUDINARY_URL in the environment or a .env file.'));
  }
  for (const w of startup.warnings || []) out.warn(w);
  out.print(out.c.dim('Type "help" for commands, "config" for account details.\n'));

  // Questions asked by commands (rl.question) must not be treated as new command lines.
  let busy = false;
  const ask = () => {
    rl.setPrompt(promptText(session, out));
    rl.prompt();
  };

  rl.on('line', async (line) => {
    if (busy) return;
    const trimmed = line.trim();
    if (!trimmed) return ask();
    recordHistory(rl, trimmed);
    let tokens;
    try {
      tokens = tokenize(trimmed);
    } catch (e) {
      out.error(e.message);
      return ask();
    }
    if (tokens[0] === 'exit' || tokens[0] === 'quit') {
      rl.close();
      return;
    }
    busy = true;
    rl.pause();
    try {
      out.json = false;
      await dispatch(session, tokens, { out, prompter });
    } finally {
      busy = false;
      rl.resume();
      ask();
    }
  });

  rl.on('SIGINT', () => {
    if (rl.line) {
      rl.write(null, { ctrl: true, name: 'u' });
      out.print('');
      ask();
    } else {
      rl.close();
    }
  });

  rl.on('close', () => {
    out.print('');
    process.exitCode = EXIT.OK;
  });

  ask();
}
