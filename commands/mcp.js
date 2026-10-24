import chalk from 'chalk';
import { handleMcpMessage } from '../lib/mcp.js';

export default async function mcpCmd(ctx, _args = [], _flags = {}) {
  const { printer } = ctx;

  printer.println(chalk.bold('\n🔍 Cloudinary MCP (Model Context Protocol) Diagnostics\n'));

  // 1. Test handshake
  const initRes = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  }, ctx);

  printer.println(chalk.green('✔ Protocol Handshake: ') + `protocolVersion: ${initRes.result.protocolVersion}`);
  printer.println(chalk.green('✔ Server Identity:   ') + `${initRes.result.serverInfo.name} v${initRes.result.serverInfo.version}`);

  // 2. Test tools list
  const toolsRes = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, ctx);

  printer.println(chalk.green(`✔ Registered Tools (${toolsRes.result.tools.length}):`));
  for (const t of toolsRes.result.tools) {
    printer.println(`  • ${chalk.cyan(t.name.padEnd(22))} ${chalk.dim(t.description.split('.')[0])}`);
  }

  // 3. Test live tool execution on active account
  printer.println(printer.dim('\nExecuting live tool call (cloudinary_list) on your account...'));
  try {
    const callRes = await handleMcpMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'cloudinary_list',
        arguments: { path: ctx.cwd || '' },
      },
    }, ctx);

    if (callRes.result?.isError) {
      printer.println(printer.error(`✖ Tool Execution Failed: ${callRes.result.content[0].text}`));
    } else {
      const data = JSON.parse(callRes.result.content[0].text);
      printer.println(chalk.green('✔ Live Tool Call Succeeded:'));
      printer.println(`  Found: ${chalk.bold(data.folders.length)} folder(s) and ${chalk.bold(data.files.length)} asset(s) in "${data.folder}"`);
    }
  } catch (e) {
    printer.println(printer.error(`✖ Tool Error: ${e?.message || String(e)}`));
  }

  printer.println(chalk.bold('\nStatus: Ready to connect to Claude Desktop, Cursor, and any MCP client!'));
  printer.println(printer.dim('Run as stdio server: cldsh --mcp\n'));
}
