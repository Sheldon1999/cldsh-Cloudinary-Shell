export const spec = {
  name: 'pwd',
  usage: 'pwd',
  summary: 'Show current Cloudinary folder path',
  flags: {},
};

export default async function pwd(ctx) {
  return { cwd: '/' + ctx.cwd };
}

export function render(result, ctx) {
  ctx.out.print(result.cwd);
}
