// Command registry. Each module exports `spec` (name, usage, summary, flags, ...) and a default
// `run(ctx, args, flags)` returning a result object; an optional `render(result, ctx)` prints it
// for humans. The order here is the order shown by `help`.
import * as help from './help.js';
import * as login from './login.js';
import * as config from './config.js';
import * as ls from './ls.js';
import * as cd from './cd.js';
import * as pwd from './pwd.js';
import * as lcd from './lcd.js';
import * as lpwd from './lpwd.js';
import * as mkdir from './mkdir.js';
import * as upload from './upload.js';
import * as download from './download.js';
import * as mv from './mv.js';
import * as info from './info.js';
import * as open from './open.js';
import * as view from './view.js';
import * as url from './url.js';
import * as rm from './rm.js';
import * as tree from './tree.js';
import * as quota from './quota.js';
import * as mcp from './mcp.js';

export const COMMAND_MODULES = [help, login, config, ls, cd, pwd, lcd, lpwd, mkdir, upload, download, mv, info, open, view, url, rm, tree, quota, mcp];

export const COMMANDS = new Map();
for (const mod of COMMAND_MODULES) {
  COMMANDS.set(mod.spec.name, mod);
  for (const alias of mod.spec.aliases || []) COMMANDS.set(alias, mod);
}

/** Names the shell completes and `help` lists (aliases included), plus the REPL-only exit words. */
export const COMMAND_NAMES = [...COMMANDS.keys(), 'exit', 'quit'];
