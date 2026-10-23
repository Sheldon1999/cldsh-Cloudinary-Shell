import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export default async function lcd(ctx, args = []) {
  const { printer } = ctx;
  const target = args[0];

  let dest;
  if (!target || target === '~') {
    dest = os.homedir();
  } else if (target.startsWith('~')) {
    dest = path.join(os.homedir(), target.slice(1));
  } else {
    dest = path.resolve(process.cwd(), target);
  }

  try {
    if (!fs.existsSync(dest)) {
      return printer.println(printer.warn(`No such local directory: ${target}`));
    }
    const stat = fs.statSync(dest);
    if (!stat.isDirectory()) {
      return printer.println(printer.warn(`Not a directory: ${target}`));
    }
    process.chdir(dest);
    printer.println(printer.ok(`Local directory: ${process.cwd()}`));
  } catch (e) {
    printer.println(printer.error(`Failed to change local directory: ${e?.message || String(e)}`));
  }
}
