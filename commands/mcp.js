// `cldsh mcp`: self-test of the MCP server, in-process (no stdio). Checks the handshake for every
// supported protocol version, the tool list, and two live read-only tool calls on the active
// account. Exits 1 when a check fails.
import { createMcpServer, SUPPORTED_VERSIONS, LATEST_VERSION } from '../lib/mcp.js';
import { EXIT } from '../lib/errors.js';
import { VERSION } from '../lib/version.js';

export const spec = {
  name: 'mcp',
  usage: 'mcp',
  summary: 'Check the MCP server: handshake, tools, live call on the active account',
  flags: {},
  notes: ['Run the server for an AI client with: cldsh --mcp [--read-only] [--no-confirm] [--allow-path <dir>]'],
};

/** Run one live tool call; returns { ok, data } or { ok: false, error }. */
async function live(server, id, name, args) {
  const res = await server.handleMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  if (res.error) return { ok: false, error: { code: res.error.code, message: res.error.message } };
  if (res.result.isError) return { ok: false, error: res.result.structuredContent?.error ?? { message: res.result.content[0].text } };
  return { ok: true, data: res.result.structuredContent ?? JSON.parse(res.result.content[0].text) };
}

export default async function mcp(ctx) {
  let id = 0;
  const handshakes = [];
  let serverInfo = null;
  for (const requested of [...SUPPORTED_VERSIONS, '1999-01-01']) {
    const server = createMcpServer();
    const res = await server.handleMessage({
      jsonrpc: '2.0', id: ++id, method: 'initialize',
      params: { protocolVersion: requested, capabilities: {}, clientInfo: { name: 'cldsh-diagnostics', version: VERSION } },
    });
    const negotiated = res.result?.protocolVersion;
    const expected = SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION;
    const tools = (await server.handleMessage({ jsonrpc: '2.0', id: ++id, method: 'tools/list' })).result?.tools ?? [];
    serverInfo ??= res.result?.serverInfo ?? null;
    handshakes.push({
      requested,
      negotiated,
      tools: tools.length,
      ok: negotiated === expected && tools.length > 0 && tools.every(t => t.annotations && t.inputSchema),
    });
  }

  const server = createMcpServer();
  await server.handleMessage({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: LATEST_VERSION, capabilities: {} } });
  const list = (await server.handleMessage({ jsonrpc: '2.0', id: ++id, method: 'tools/list' })).result.tools;
  const tools = list.map(t => ({
    name: t.name,
    title: t.title,
    read_only: Boolean(t.annotations.readOnlyHint),
    destructive: Boolean(!t.annotations.readOnlyHint && t.annotations.destructiveHint),
  }));

  const account = await live(server, ++id, 'cloudinary_account', {});
  const folder = ctx.cwd ? `/${ctx.cwd}` : '/';
  const listing = account.ok ? await live(server, ++id, 'cloudinary_list', { path: folder }) : { ok: false, skipped: true };

  const ok = handshakes.every(h => h.ok) && account.ok && listing.ok;
  if (!ok) ctx.setExitCode(EXIT.ERROR);
  return {
    ok,
    server: serverInfo,
    handshakes,
    tools,
    folder_mode: account.ok ? account.data.folder_mode : null,
    account: account.ok ? account.data : { error: account.error },
    list: listing.ok
      ? { folder: listing.data.folder, folders: listing.data.folders.length, files: listing.data.files.length, truncated: listing.data.truncated }
      : (listing.skipped ? { skipped: true } : { error: listing.error }),
  };
}

export function render(result, ctx) {
  const { c } = ctx.out;
  const okMark = c.green('✔');
  const badMark = c.red('✖');
  const mark = (ok) => (ok ? okMark : badMark);
  ctx.out.print(c.bold('Cloudinary MCP server diagnostics'));
  ctx.out.print(`${okMark} Server: ${result.server?.name} v${result.server?.version}`);
  for (const h of result.handshakes) {
    const label = SUPPORTED_VERSIONS.includes(h.requested) ? h.requested : `${h.requested} (unsupported)`;
    ctx.out.print(`${mark(h.ok)} Handshake ${label.padEnd(26)} -> ${h.negotiated}, ${h.tools} tools`);
  }
  ctx.out.print(`${okMark} Tools (${result.tools.length}):`);
  for (const t of result.tools) {
    const label = (t.read_only ? 'read-only' : (t.destructive ? 'destructive' : 'writes')).padEnd(12);
    const tag = t.destructive ? c.yellow(label) : c.dim(label);
    ctx.out.print(`    ${c.cyan(t.name.padEnd(26))} ${tag} ${c.dim(t.title)}`);
  }
  if (result.account.error) {
    ctx.out.print(`${badMark} cloudinary_account: ${result.account.error.message}`);
  } else {
    const a = result.account;
    const rate = a.rate_limit ? `, ${a.rate_limit.remaining}/${a.rate_limit.allowed} Admin API requests left` : '';
    ctx.out.print(`${okMark} cloudinary_account: cloud "${a.cloud_name}", ${a.folder_mode} folder mode, credentials from ${a.credential_source}${rate}`);
  }
  if (result.list.error) ctx.out.print(`${badMark} cloudinary_list: ${result.list.error.message}`);
  else if (!result.list.skipped) {
    ctx.out.print(`${okMark} cloudinary_list: ${result.list.folders} folder(s) and ${result.list.files} asset(s) in "${result.list.folder}"`);
  }
  ctx.out.print('');
  ctx.out.print(result.ok
    ? c.bold('Ready: add "cldsh --mcp" to Claude Desktop, Cursor, Claude Code or any MCP client.')
    : c.red('Some checks failed (see above).'));
}
