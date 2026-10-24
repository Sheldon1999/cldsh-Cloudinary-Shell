import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { handleMcpMessage, MCP_TOOLS } from '../lib/mcp.js';

const CLDSH_BIN = path.resolve(process.cwd(), 'cldsh.js');

test('mcp: initialize handshake returns server capabilities', async () => {
  const res = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  });

  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, 'cloudinary-shell');
  assert.ok(res.result.capabilities.tools);
});

test('mcp: ping responds with empty result', async () => {
  const res = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping',
  });
  assert.deepEqual(res.result, {});
});

test('mcp: tools/list declares all 8 native Cloudinary tools', async () => {
  const res = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: {},
  });

  assert.equal(res.result.tools.length, 8);
  const toolNames = res.result.tools.map(t => t.name);
  assert.ok(toolNames.includes('cloudinary_list'));
  assert.ok(toolNames.includes('cloudinary_upload'));
  assert.ok(toolNames.includes('cloudinary_get_url'));
  assert.ok(toolNames.includes('cloudinary_info'));
  assert.ok(toolNames.includes('cloudinary_delete'));
  assert.ok(toolNames.includes('cloudinary_move'));
  assert.ok(toolNames.includes('cloudinary_tree'));
  assert.ok(toolNames.includes('cloudinary_download'));

  // Verify inputSchema exists on each tool
  for (const t of res.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.description.length > 10);
  }
});

test('mcp: tools/call dry-run upload executes and returns structured content', async () => {
  const res = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'cloudinary_upload',
      arguments: {
        local_path: 'package.json',
        dry_run: true,
      },
    },
  });

  assert.equal(res.id, 4);
  assert.equal(res.result.content[0].type, 'text');
  const parsed = JSON.parse(res.result.content[0].text);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.items[0].publicId, 'package');
});

test('mcp: tools/call dry-run move executes cleanly', async () => {
  const res = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'cloudinary_move',
      arguments: {
        source: 'hero',
        target: 'archive/',
        dry_run: true,
      },
    },
  });

  assert.equal(res.id, 5);
  const parsed = JSON.parse(res.result.content[0].text);
  assert.equal(parsed.from, 'hero');
  assert.equal(parsed.to, 'archive/hero');
  assert.equal(parsed.dryRun, true);
});

test('mcp: tools/call unknown tool returns isError block', async () => {
  const res = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'non_existent_tool',
      arguments: {},
    },
  });

  assert.equal(res.result.isError, true);
  assert.ok(res.result.content[0].text.includes('Unknown MCP tool'));
});

test('mcp: stdio integration test with child process', async () => {
  const proc = spawn(process.execPath, [CLDSH_BIN, '--mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutData = '';
  let stderrData = '';

  proc.stdout.on('data', chunk => {
    stdoutData += chunk.toString();
  });
  proc.stderr.on('data', chunk => {
    stderrData += chunk.toString();
  });

  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 101,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  }) + '\n';

  proc.stdin.write(request);

  // Wait briefly for response
  await new Promise(r => setTimeout(r, 200));

  proc.kill('SIGINT');

  assert.ok(stderrData.includes('Starting Cloudinary Shell'));
  const lines = stdoutData.trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 101);
  assert.equal(parsed.result.serverInfo.name, 'cloudinary-shell');
});
