export default async function pwd(ctx) {
  console.log('/' + (ctx.cwd || ''));
}
