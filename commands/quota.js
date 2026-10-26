export const spec = {
  name: 'quota',
  usage: 'quota',
  summary: 'Show the Admin API hourly rate limit and the folder mode',
  flags: {},
};

export default async function quota(ctx) {
  const backend = await ctx.backend();
  await backend.ping();
  return { cloud_name: backend.cloudName, folder_mode: backend.mode, rate_limit: backend.rate };
}

export function render(result, ctx) {
  const { out } = ctx;
  const r = result.rate_limit;
  out.print(`Cloud:        ${result.cloud_name}`);
  out.print(`Folder mode:  ${result.folder_mode}`);
  if (r) {
    out.print(`Admin API:    ${r.remaining} of ${r.allowed} requests left this hour${r.resetAt ? ` (resets ${r.resetAt})` : ''}`);
  } else {
    out.print('Admin API:    rate limit not reported');
  }
}
