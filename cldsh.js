#!/usr/bin/env node
import readline from 'node:readline';
import process from 'node:process';
import { loadEnvAndConfig } from './lib/env.js';
import * as printer from './lib/printer.js';
import { parseLine } from './lib/parse.js';
import * as cld from './lib/cld.js';

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

loadEnvAndConfig();

let cwd = '';
let prevCwd = '';
const setCwd = (next) => { prevCwd = cwd; cwd = cld.norm(next); };
const getPrompt = () => (cwd ? `$~/${cwd} ` : `$~ `);

const ctx = {
  get cwd() { return cwd; },
  get prevCwd() { return prevCwd; },
  setCwd,
  utils: cld,
  printer,
};

const commands = {
  help: helpCmd,
  ls: lsCmd,
  cd: cdCmd,
  mkdir: mkdirCmd,
  upload: uploadCmd,
  rm: rmCmd,
  pwd: pwdCmd,
  tree: treeCmd,
  url: urlCmd,
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

printer.println(printer.dim('Cloudinary Shell — type "help" for commands.'));

function ask() { rl.question(getPrompt(), onLine); }

async function onLine(line) {
  const { cmd, args, flags } = parseLine(line);
  try {
    if (!cmd) return ask();
    if (cmd === 'exit' || cmd === 'quit') { rl.close(); process.exit(0); return; }
    const run = commands[cmd];
    if (!run) {
      printer.println(printer.warn(`Unknown command: ${cmd}`));
      printer.println(printer.dim('Type "help" to see available commands.'));
    } else {
      await run(ctx, args, flags);
    }
  } catch (e) {
    printer.println(printer.error(e?.message || String(e)));
  }
  ask();
}

ask();
