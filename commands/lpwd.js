import process from 'node:process';

export const spec = {
  name: 'lpwd',
  usage: 'lpwd',
  summary: 'Show current local directory on this machine',
  flags: {},
};

export default async function lpwd() {
  return { cwd: process.cwd() };
}

export function render(result, ctx) {
  ctx.out.print(result.cwd);
}
