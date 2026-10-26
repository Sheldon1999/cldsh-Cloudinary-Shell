import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { resolveLocal } from '../lib/paths.js';
import { CldshError, CODES } from '../lib/errors.js';

export const spec = {
  name: 'lcd',
  usage: 'lcd [local_path]',
  summary: 'Change local directory on this machine (default: home)',
  flags: {},
};

export default async function lcd(ctx, args) {
  const dest = resolveLocal(args[0] || '~');
  let stat;
  try {
    stat = fs.statSync(dest);
  } catch {
    throw new CldshError(CODES.NOT_FOUND, `No such local directory: ${args[0]}`);
  }
  if (!stat.isDirectory()) throw new CldshError(CODES.LOCAL, `Not a directory: ${args[0]}`);
  process.chdir(dest);
  return { cwd: process.cwd(), dotenv: fs.existsSync(path.join(dest, '.env')) };
}

export function render(result, ctx) {
  ctx.out.success(`Local directory: ${result.cwd}`);
  if (result.dotenv) {
    ctx.out.info('This directory has a .env file; the active Cloudinary account is unchanged. Restart cldsh here to use it.');
  }
}
