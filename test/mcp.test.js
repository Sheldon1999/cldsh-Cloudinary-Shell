// MCP protocol layer: JSON-RPC handling, notifications, cancellation, version negotiation, tool
// metadata, argument validation, server options. Spawned tests run the real `cldsh --mcp` binary
// against the fake SDK; the others drive createMcpServer in-process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary } from '../lib/sdk.js';
import { applyCredentials } from '../lib/env.js';
import { resetBackend } from '../lib/backend/index.js';
import { VERSION } from '../lib/version.js';
import { createMcpServer, parseServerArgs, SUPPORTED_VERSIONS, LATEST_VERSION, ERR } from '../lib/mcp.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { runCli } from './helpers/cli.js';

const OLD_TOOLS = ['cloudinary_list', 'cloudinary_upload', 'cloudinary_get_url', 'cloudinary_info', 'cloudinary_delete', 'cloudinary_move', 'cloudinary_tree', 'cloudinary_download'];
const NEW_TOOLS = ['cloudinary_mkdir', 'cloudinary_rename_folder', 'cloudinary_account'];
const READ_ONLY = ['cloudinary_list', 'cloudinary_get_url', 'cloudinary_info', 'cloudinary_tree', 'cloudinary_account'];

const lines = (...msgs) => msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n';
const parseOut = (stdout) => stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
const init = (id = 1, protocolVersion = LATEST_VERSION, capabilities = {}) =>
  ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion, capabilities, clientInfo: { name: 'test', version: '1' } } });
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

/** In-process server against the fake, with credentials for the fake cloud. */
function setup({ folderMode = 'dynamic', ...opts } = {}) {
  const fake = createFakeCloudinary({ folderMode });
  const restore = installFake(cloudinary, fake);
  resetBackend();
  applyCredentials({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret', source: 'test', profile: 'env' });
  const sent = [];
  const server = createMcpServer({ send: m => sent.push(m), ...opts });
  return {
    fake,
    server,
    sent,
    rpc: (msg) => server.handleMessage(msg),
    done() { restore(); resetBackend(); applyCredentials(null); },
  };
}

// ---------------------------------------------------------------- stdio transport (spawned)

test('stdio: notifications never get a response; stdout carries only protocol messages', async () => {
  const res = await runCli(['--mcp'], {
    input: lines(
      init(1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99, reason: 'test' } },
      { jsonrpc: '2.0', method: 'notifications/something_unknown', params: {} },
      { jsonrpc: '2.0', method: 'tools/list' }, // no id: a notification, even for a request method
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ),
  });
  assert.equal(res.code, 0, res.stderr);
  const out = parseOut(res.stdout);
  assert.deepEqual(out.map(m => m.id), [1, 2]);
  assert.deepEqual(out[1].result, {});
  assert.match(res.stderr, /MCP server on stdio/);
});

test('stdio: parse errors and unknown methods are answered; unknown option refuses to start', async () => {
  const res = await runCli(['--mcp'], { input: lines('{not json', { jsonrpc: '2.0', id: 7, method: 'no/such' }) });
  const out = parseOut(res.stdout);
  assert.equal(out.find(m => m.id === null).error.code, ERR.PARSE);
  assert.equal(out.find(m => m.id === 7).error.code, ERR.METHOD_NOT_FOUND);

  const bad = await runCli(['--mcp', '--readonly'], { input: lines(init(1)) });
  assert.equal(bad.code, 2);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /--readonly/);
});

test('stdio: rate-limited tool call returns a readable isError result', async () => {
  const fake = createFakeCloudinary();
  fake.seedFolder('photos');
  fake.setRateRemaining(0);
  const res = await runCli(['--mcp'], { fake, input: lines(init(1), call(2, 'cloudinary_list', { path: 'photos' })), env: { CLDSH_FOLDER_MODE: 'dynamic' } });
  const r = parseOut(res.stdout).find(m => m.id === 2).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /RATE_LIMITED/);
  assert.match(r.content[0].text, /Rate Limit Exceeded/);
  assert.match(r.content[0].text, /hourly limit/);
  assert.equal(r.structuredContent.error.code, 'RATE_LIMITED');
});

test('stdio: --no-confirm deletes in one call and warns at startup', async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'a/x' });
  fake.seed({ public_id: 'b/y' });
  const res = await runCli(['--mcp', '--no-confirm'], { fake, input: lines(init(1), call(2, 'cloudinary_delete', { target: 'a', recursive: true })) });
  assert.match(res.stderr, /WARNING: --no-confirm/);
  const r = parseOut(res.stdout).find(m => m.id === 2).result;
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(r.structuredContent.summary.deleted, 1);
  assert.deepEqual(res.state.assets.map(a => a.public_id), ['b/y']);
});

test('stdio: --read-only hides and refuses tools that change anything', async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'a/x' });
  const res = await runCli(['--mcp', '--read-only'], {
    fake,
    input: lines(init(1), { jsonrpc: '2.0', id: 2, method: 'tools/list' }, call(3, 'cloudinary_delete', { target: 'a', recursive: true, confirm_token: 'x' })),
  });
  const out = parseOut(res.stdout);
  assert.deepEqual(out.find(m => m.id === 2).result.tools.map(t => t.name).sort(), [...READ_ONLY].sort());
  const refused = out.find(m => m.id === 3);
  assert.equal(refused.error.code, ERR.INVALID_PARAMS);
  assert.match(refused.error.message, /read-only/);
  assert.equal(res.state.assets.length, 1);
  assert.ok(!res.calls.some(c => /delete/.test(c.method)));
});

test('stdio: without credentials tool calls fail with NOT_CONFIGURED, the protocol still works', async () => {
  const res = await runCli(['--mcp'], { credentials: false, input: lines(init(1), call(2, 'cloudinary_account', {})) });
  const out = parseOut(res.stdout);
  assert.equal(out[0].result.protocolVersion, LATEST_VERSION);
  assert.equal(out[1].result.isError, true);
  assert.match(out[1].result.content[0].text, /NOT_CONFIGURED/);
  assert.match(res.stderr, /no Cloudinary credentials/);
});

// ---------------------------------------------------------------- handshake and metadata

for (const v of SUPPORTED_VERSIONS) {
  test(`initialize ${v}: negotiates ${v}, advertises only tools, tools carry annotations`, async () => {
    const s = setup();
    try {
      const res = await s.rpc(init(1, v));
      assert.equal(res.result.protocolVersion, v);
      assert.deepEqual(Object.keys(res.result.capabilities), ['tools']);
      assert.equal(res.result.serverInfo.name, 'cloudinary-shell');
      assert.equal(res.result.serverInfo.version, VERSION);

      const { tools } = (await s.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result;
      assert.deepEqual(tools.map(t => t.name).sort(), [...OLD_TOOLS, ...NEW_TOOLS].sort());
      for (const t of tools) {
        assert.equal(typeof t.title, 'string');
        assert.equal(t.inputSchema.type, 'object');
        for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
          assert.equal(typeof t.annotations[hint], 'boolean', `${t.name}.${hint}`);
        }
        assert.equal(Boolean(t.outputSchema), v === '2025-06-18', `${t.name} outputSchema`);
        assert.equal(t.annotations.readOnlyHint, READ_ONLY.includes(t.name), t.name);
      }
      for (const name of ['cloudinary_delete', 'cloudinary_move']) {
        assert.equal(tools.find(t => t.name === name).annotations.destructiveHint, true);
      }
      assert.deepEqual((await s.rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).result, { resources: [] });
      assert.deepEqual((await s.rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/list' })).result, { prompts: [] });
      assert.deepEqual((await s.rpc({ jsonrpc: '2.0', id: 5, method: 'resources/templates/list' })).result, { resourceTemplates: [] });
    } finally { s.done(); }
  });
}

test('initialize with an unknown or missing version answers with the newest', async () => {
  for (const requested of ['2099-01-01', undefined]) {
    const s = setup();
    try {
      const res = await s.rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: requested, capabilities: {} } });
      assert.equal(res.result.protocolVersion, LATEST_VERSION);
    } finally { s.done(); }
  }
});

test('structuredContent only for 2025-06-18; text content for every version', async () => {
  for (const v of SUPPORTED_VERSIONS) {
    const s = setup();
    try {
      s.fake.seed({ public_id: 'p/one' });
      await s.rpc(init(1, v));
      const r = (await s.rpc(call(2, 'cloudinary_list', { path: 'p' }))).result;
      const fromText = JSON.parse(r.content[0].text);
      assert.equal(fromText.files[0].public_id, 'p/one');
      if (v === '2025-06-18') assert.deepEqual(r.structuredContent, fromText);
      else assert.equal(r.structuredContent, undefined);
    } finally { s.done(); }
  }
});

test('the 1.0.0 argument payloads still validate', async () => {
  const s = setup();
  try {
    await s.rpc(init(1));
    const payloads = {
      cloudinary_list: { path: 'p', resource_type: 'image', max: 10 },
      cloudinary_upload: { local_path: 'x.png', name: 'n', folder: 'f', recursive: false, overwrite: true, resource_type: 'image', dry_run: true },
      cloudinary_get_url: { public_id: 'x', transformation: 'w_10', signed: false, resource_type: 'image' },
      cloudinary_info: { public_id: 'x', resource_type: 'video' },
      cloudinary_delete: { target: 'x', recursive: false, resource_type: 'raw', dry_run: true },
      cloudinary_move: { source: 'x', target: 'y', overwrite: false, resource_type: 'image', dry_run: true },
      cloudinary_tree: { folder: '', depth: 2, resource_type: 'image' },
      cloudinary_download: { public_id: 'x', destination: 'out', resource_type: 'image' },
    };
    const { tools } = (await s.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result;
    let id = 10;
    for (const [name, args] of Object.entries(payloads)) {
      const props = Object.keys(tools.find(t => t.name === name).inputSchema.properties);
      for (const k of Object.keys(args)) assert.ok(props.includes(k), `${name}.${k}`);
      const res = await s.rpc(call(++id, name, args));
      assert.ok(res.result, `${name}: ${JSON.stringify(res.error)}`);
    }
  } finally { s.done(); }
});

// ---------------------------------------------------------------- validation and errors

test('invalid tool arguments are rejected with -32602 before anything runs', async () => {
  const s = setup();
  try {
    await s.rpc(init(1));
    const cases = [
      ['cloudinary_list', { resource_type: 'pdf' }, /resource_type.*one of/],
      ['cloudinary_delete', {}, /missing required argument "target"/],
      ['cloudinary_delete', { target: 'x', recursive: 'yes' }, /recursive.*boolean/],
      ['cloudinary_list', { max: 1.5 }, /max.*integer/],
      ['cloudinary_delete', { target: 'x', confirm: true }, /unknown argument "confirm"/],
    ];
    let id = 1;
    for (const [name, args, re] of cases) {
      const res = await s.rpc(call(++id, name, args));
      assert.equal(res.error?.code, ERR.INVALID_PARAMS, `${name} ${JSON.stringify(args)}`);
      assert.match(res.error.message, re);
    }
    const unknown = await s.rpc(call(++id, 'cloudinary_format_disk', {}));
    assert.equal(unknown.error.code, ERR.INVALID_PARAMS);
    assert.equal(s.fake.calls.length, 0);
  } finally { s.done(); }
});

test('requests: unknown method -32601, malformed request -32600, batches answered without notifications', async () => {
  const s = setup();
  try {
    assert.equal((await s.rpc({ jsonrpc: '2.0', id: 1, method: 'logging/setLevel', params: {} })).error.code, ERR.METHOD_NOT_FOUND);
    assert.equal((await s.rpc({ jsonrpc: '2.0', id: 2 })).error.code, ERR.INVALID_REQUEST);
    assert.equal(await s.rpc({ jsonrpc: '2.0', method: 'no/such/notification' }), null);
    const batch = await s.rpc([{ jsonrpc: '2.0', id: 3, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]);
    assert.deepEqual(batch.map(r => r.id), [3]);
  } finally { s.done(); }
});

test('tool failures are isError results with the normalized error', async () => {
  const s = setup();
  try {
    await s.rpc(init(1));
    const r = (await s.rpc(call(2, 'cloudinary_info', { public_id: 'nope' }))).result;
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /^Error \(NOT_FOUND\): No such asset: nope/);
    assert.equal(r.structuredContent.error.code, 'NOT_FOUND');
  } finally { s.done(); }
});

// ---------------------------------------------------------------- cancellation

test('notifications/cancelled aborts the request: no response, nothing executed', async () => {
  // --no-confirm: without the cancellation this call would delete in one step.
  const s = setup({ noConfirm: true });
  try {
    s.fake.seed({ public_id: 'a/x' });
    await s.rpc(init(1));
    // Hold the plan's first listing until the request has been cancelled.
    let release;
    const gate = new Promise(r => { release = r; });
    const real = cloudinary.api.resources_by_asset_folder;
    cloudinary.api.resources_by_asset_folder = async (...a) => { await gate; return real(...a); };
    const pending = s.server.handleLine(JSON.stringify(call(42, 'cloudinary_delete', { target: 'a', recursive: true })));
    assert.equal(await s.rpc({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42 } }), null);
    release();
    await pending;
    await s.server.idle();
    cloudinary.api.resources_by_asset_folder = real;
    assert.deepEqual(s.sent, []);
    assert.equal(s.fake.state.assets.length, 1);
    // The server keeps working afterwards.
    assert.deepEqual((await s.rpc({ jsonrpc: '2.0', id: 43, method: 'ping' })).result, {});
  } finally { s.done(); }
});

// ---------------------------------------------------------------- options

test('parseServerArgs: options, repeatable --allow-path, unknown options refused', () => {
  assert.deepEqual(parseServerArgs(['--mcp']), { readOnly: false, noConfirm: false, allowPaths: [] });
  assert.deepEqual(
    parseServerArgs(['--mcp', '--read-only', '--no-confirm', '--allow-path', '/a', '--allow-path=/b']),
    { readOnly: true, noConfirm: true, allowPaths: ['/a', '/b'] },
  );
  assert.throws(() => parseServerArgs(['--mcp', '--allow-path']), /needs a directory/);
  assert.throws(() => parseServerArgs(['--mcp', '--yes']), (e) => e.code === 'USAGE');
});

// ---------------------------------------------------------------- `cldsh mcp` diagnostics

test('cldsh mcp: handshakes, 11 tools, live account and list call; exit 1 when the live call fails', async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'p/one' });
  const res = await runCli(['mcp', '--json'], { fake });
  assert.equal(res.code, 0, res.stderr);
  const r = JSON.parse(res.stdout);
  assert.equal(r.ok, true);
  assert.equal(r.server.version, VERSION);
  assert.deepEqual(r.handshakes.map(h => [h.requested, h.negotiated, h.ok]), [
    ...SUPPORTED_VERSIONS.map(v => [v, v, true]),
    ['1999-01-01', LATEST_VERSION, true],
  ]);
  assert.equal(r.tools.length, 11);
  assert.equal(r.folder_mode, 'dynamic');
  assert.equal(r.account.cloud_name, 'fake-cloud');
  assert.deepEqual(r.list, { folder: '/', folders: 1, files: 0, truncated: false });

  const human = await runCli(['mcp'], { fake });
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /cloudinary_rename_folder/);

  const off = await runCli(['mcp', '--json'], { credentials: false });
  assert.equal(off.code, 1);
  const o = JSON.parse(off.stdout);
  assert.equal(o.ok, false);
  assert.equal(o.account.error.code, 'NOT_CONFIGURED');
});
