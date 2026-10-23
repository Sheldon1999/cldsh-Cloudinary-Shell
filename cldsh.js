#!/usr/bin/env node
import readline from 'node:readline';
import process from 'node:process';
import chalk from 'chalk';
import { loadEnvAndConfig, isConfigured } from './lib/env.js';
import * as printer from './lib/printer.js';
import { parseLine } from './lib/parse.js';
import * as cld from './lib/cld.js';
import { createCompleter } from './lib/completer.js';
import { loadHistory, appendHistoryLine, pruneHistory } from './lib/history.js';

// Commands
import helpCmd from './commands/help.js';
import lsCmd from './commands/ls.js';
import cdCmd from './commands/cd.js';
import mkdirCmd from './commands/mkdir.js';
import uploadCmd from './commands/upload.js';
import rmCmd from './commands/rm.js';
import pwdCmd from './commands/pwd.js';
import treeCmd from './commands/tree.js';
import urlCmd from './commands/url.js';
import infoCmd from './commands/info.js';
import openCmd from './commands/open.js';
import downloadCmd from './commands/download.js';
import configCmd from './commands/config.js';
import loginCmd from './commands/login.js';
import viewCmd from './commands/view.js';
import mvCmd from './commands/mv.js';
import lcdCmd from './commands/lcd.js';
import lpwdCmd from './commands/lpwd.js';

const envStatus = loadEnvAndConfig();

let cwd = '';
let prevCwd = '';
let currentCloud = envStatus.cloud_name || '';

const setCwd = (next) => { prevCwd = cwd; cwd = cld.norm(next); };
const updateAccountPrompt = (name) => { currentCloud = name || ''; };

const getPrompt = () => {
  const accountTag = currentCloud ? chalk.cyan(`[${currentCloud}]`) : chalk.dim('[disconnected]');
  const pathPart = cwd ? `~/${cwd}` : '~';
  return `${accountTag}$${pathPart} `;
};

let rl;

const ctx = {
  get cwd() { return cwd; },
  get prevCwd() { return prevCwd; },
  get cloudName() { return currentCloud; },
  setCwd,
  updateAccountPrompt,
  askUser: (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim()))),
  utils: cld,
  printer,
};

const commands = {
  help: helpCmd,
  login: loginCmd,
  config: configCmd,
  ls: lsCmd,
  cd: cdCmd,
  mkdir: mkdirCmd,
  upload: uploadCmd,
  rm: rmCmd,
  pwd: pwdCmd,
  tree: treeCmd,
  url: urlCmd,
  info: infoCmd,
  open: openCmd,
  download: downloadCmd,
  view: viewCmd,
  preview: viewCmd,
  mv: mvCmd,
  lcd: lcdCmd,
  lpwd: lpwdCmd,
};

rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: createCompleter(ctx, Object.keys(commands)),
});

// Load persistent history across sessions
rl.history = loadHistory();

// Prune history file on exit
process.on('exit', () => pruneHistory());

if (envStatus.configured) {
  printer.println(printer.dim(`Connected to Cloudinary account: ${chalk.bold(envStatus.cloud_name)} (${envStatus.source})`));
  printer.println(printer.dim('Type "help" for commands, "config" for account details.\n'));
} else {
  printer.println(chalk.yellow('┌─────────────────────────────────────────────────────────────┐'));
  printer.println(chalk.yellow('│') + chalk.bold(' Welcome to Cloudinary Shell (cldsh)!                        ') + chalk.yellow('│'));
  printer.println(chalk.yellow('│') + ' No Cloudinary account connected yet.                        ' + chalk.yellow('│'));
  printer.println(chalk.yellow('│') + ' Run ' + chalk.cyan('login') + ' to connect your credentials, or set in .env.    ' + chalk.yellow('│'));
  printer.println(chalk.yellow('└─────────────────────────────────────────────────────────────┘\n'));
}

function ask() { rl.question(getPrompt(), onLine); }

async function onLine(line) {
  const trimmed = line.trim();
  if (trimmed) {
    appendHistoryLine(trimmed);
  }

  const { cmd, args, flags } = parseLine(line);
  try {
    if (!cmd) return ask();
    if (cmd === 'exit' || cmd === 'quit') { rl.close(); process.exit(0); return; }
    const run = commands[cmd];
    if (!run) {
      printer.println(printer.warn(`Unknown command: ${cmd}`));
      printer.println(printer.dim('Type "help" to see available commands.'));
    } else {
      // If not configured and command requires Cloudinary network access, guide user to login
      const offlineCommands = ['help', 'login', 'config', 'exit', 'quit', 'pwd', 'lpwd', 'lcd'];
      if (!isConfigured() && !offlineCommands.includes(cmd)) {
        printer.println(printer.warn(`Not connected to a Cloudinary account.`));
        printer.println(printer.dim(`Type "login" to connect your account or "config" for options.`));
      } else {
        await run(ctx, args, flags);
      }
    }
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
  ask();
}

ask();
