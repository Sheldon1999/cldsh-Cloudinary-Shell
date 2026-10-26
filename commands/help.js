import { COMMAND_MODULES, COMMANDS } from './index.js';
import { GLOBAL_FLAGS } from '../lib/parse.js';
import { usageError } from '../lib/errors.js';

export const spec = {
  name: 'help',
  usage: 'help [command]',
  summary: 'Show commands, or the options of one command',
  flags: {},
  offline: true,
};

function flagLines(flags) {
  return Object.entries(flags).map(([name, def]) => {
    const value = def.type === 'boolean' ? '' : `=${def.placeholder || def.type}`;
    const short = def.short ? `-${def.short}, ` : '    ';
    return { left: `${short}--${name}${value}`, right: def.description || '' };
  });
}

export default async function help(_ctx, args) {
  if (args[0]) {
    const mod = COMMANDS.get(args[0]);
    if (!mod) throw usageError(`Unknown command: ${args[0]}`);
    const s = mod.spec;
    return {
      command: s.name,
      usage: s.usage,
      summary: s.summary,
      aliases: s.aliases || [],
      flags: flagLines(s.flags || {}),
      notes: s.notes || [],
    };
  }
  return {
    commands: COMMAND_MODULES.map(m => ({ name: m.spec.name, usage: m.spec.usage, summary: m.spec.summary, aliases: m.spec.aliases || [] }))
      .concat([{ name: 'exit', usage: 'exit | quit', summary: 'Leave the shell', aliases: ['quit'] }]),
    global_flags: flagLines(GLOBAL_FLAGS),
  };
}

export function render(result, ctx) {
  const { out } = ctx;
  const c = out.c;
  const col = (rows) => {
    const w = Math.min(44, Math.max(...rows.map(r => r.left.length)) + 2);
    for (const r of rows) {
      if (r.left.length + 2 > w) { out.print(`  ${r.left}`); out.print(`  ${' '.repeat(w)}${r.right}`); }
      else out.print(`  ${r.left.padEnd(w)}${r.right}`);
    }
  };

  if (result.command) {
    out.print(c.bold(`Usage: ${result.usage}`));
    out.print(`  ${result.summary}`);
    if (result.aliases.length) out.print(`  Alias: ${result.aliases.join(', ')}`);
    if (result.flags.length) { out.print(''); out.print(c.bold('Options:')); col(result.flags); }
    for (const n of result.notes) out.print(`\n${n}`);
    return;
  }

  out.print(c.bold('Commands:'));
  col(result.commands.map(cmd => ({ left: cmd.usage, right: cmd.summary + (cmd.aliases.length ? ` (alias: ${cmd.aliases.join(', ')})` : '') })));
  out.print('');
  out.print(c.bold('Options for every command:'));
  col(result.global_flags);
  out.print('');
  out.print(c.bold('Tips:'));
  out.print('  "help <command>" shows all options of a command.');
  out.print('  Quote wildcards when running single commands from your shell: cldsh rm \'cld*\'.');
  out.print('  Paths are relative to the current folder; start with / for the root.');
  out.print('  Credentials: --profile / config use  >  CLOUDINARY_URL  >  ./.env  >  saved default profile.');
}
