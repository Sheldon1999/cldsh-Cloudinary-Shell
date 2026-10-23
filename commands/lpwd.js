import process from 'node:process';

export default async function lpwd(ctx) {
  const { printer } = ctx;
  printer.println(process.cwd());
}
