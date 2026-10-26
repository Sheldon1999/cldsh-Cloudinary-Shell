// MCP tools: two-step confirmation, local filesystem sandbox, uploads/downloads through the
// sandbox, new tools (mkdir, rename_folder, account), client roots. In-process server against
// the fake SDK, in both folder modes where behavior differs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudinary } from '../lib/sdk.js';
import { applyCredentials } from '../lib/env.js';
import { resetBackend } from '../lib/backend/index.js';
import { createMcpServer, LATEST_VERSION } from '../lib/mcp.js';
import { createSandbox } from '../lib/sandbox.js';
import { createConfirmStore } from '../lib/mcp/confirm.js';
import { createFakeCloudinary, installFake, installFetchShim } from './helpers/fake-cloudinary.js';
import { tempDir } from './helpers/cli.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f10000000049454e44ae426082', 'hex');

/**
 * In-process server with credentials for the fake cloud. The sandbox's base (the server's working
 * directory) is a temp "project" directory inside a temp HOME.
 */
async function setup({ folderMode = 'dynamic', noConfirm = false, readOnly = false, capabilities = {}, allow = [] } = {}) {
  const fake = createFakeCloudinary({ folderMode });
  const restore = installFake(cloudinary, fake);
  const restoreFetch = installFetchShim(fake);
  resetBackend();
  // Pin the mode: the on-disk folder-mode cache is keyed by cloud name and shared across tests.
  const savedMode = process.env.CLDSH_FOLDER_MODE;
  process.env.CLDSH_FOLDER_MODE = folderMode;
  applyCredentials({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret', source: 'environment (CLOUDINARY_URL)', profile: 'env' });
  const home = fs.realpathSync(tempDir('cldsh-mcp-home-'));
  const project = path.join(home, 'project');
  fs.mkdirSync(project);
  const sandbox = createSandbox({ base: project, home, configDir: path.join(home, '.config', 'cldsh') });
  for (const a of allow) sandbox.addRoot(a);
  const clock = { t: 1_000_000 };
  const confirm = createConfirmStore({ now: () => clock.t });
  const sent = [];
  const server = createMcpServer({ send: m => sent.push(m), sandbox, confirm, noConfirm, readOnly });
  let id = 0;
  await server.handleMessage({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: LATEST_VERSION, capabilities } });
  /** Call a tool; returns { ok, data } (data = structuredContent) or { ok: false, error }. */
  const tool = async (name, args = {}) => {
    const res = await server.handleMessage({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    if (res.error) throw new Error(`protocol error ${res.error.code}: ${res.error.message}`);
    return res.result.isError ? { ok: false, error: res.result.structuredContent.error, text: res.result.content[0].text } : { ok: true, data: res.result.structuredContent };
  };
  const write = (rel, content = PNG) => {
    const p = path.join(project, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  };
  return {
    fake, server, sent, sandbox, clock, home, project, tool, write,
    ids: () => fake.state.assets.map(a => a.public_id).sort(),
    mutations: () => fake.calls.filter(c => /delete|destroy|rename|update|upload|create_folder/.test(c.method)),
    done() {
      restore(); restoreFetch(); resetBackend(); applyCredentials(null);
      if (savedMode === undefined) delete process.env.CLDSH_FOLDER_MODE; else process.env.CLDSH_FOLDER_MODE = savedMode;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------- two-step delete

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] delete: first call changes nothing and returns a token; the token deletes exactly the plan`, async () => {
    const s = await setup({ folderMode: mode });
    try {
      s.fake.seed({ public_id: 'a/x' });
      s.fake.seed({ public_id: 'a/sub/y' });
      s.fake.seed({ public_id: 'b/z' });

      const first = await s.tool('cloudinary_delete', { target: 'a', recursive: true });
      assert.ok(first.ok, first.text);
      assert.equal(first.data.needs_confirmation, true);
      assert.equal(first.data.expires_in_seconds, 300);
      assert.equal(first.data.cloud, 'fake-cloud');
      assert.equal(first.data.plan.totals.assets, 2);
      assert.match(first.data.plan_summary, /fake-cloud/);
      assert.equal(typeof first.data.confirm_token, 'string');
      assert.deepEqual(s.mutations(), []);
      assert.equal(s.ids().length, 3);

      // Uploaded after the plan was made: not part of it, so it must survive.
      s.fake.seed({ public_id: 'a/late' });
      const second = await s.tool('cloudinary_delete', { target: 'a', recursive: true, confirm_token: first.data.confirm_token });
      assert.ok(second.ok, second.text);
      assert.equal(second.data.summary.deleted, 2);
      assert.deepEqual(s.ids(), ['a/late', 'b/z']);

      // Single use.
      const again = await s.tool('cloudinary_delete', { target: 'a', recursive: true, confirm_token: first.data.confirm_token });
      assert.equal(again.ok, false);
      assert.match(again.error.message, /Unknown or already used/);
    } finally { s.done(); }
  });
}

test('delete "*" recursive without a token deletes nothing and returns the whole-account plan', async () => {
  const s = await setup();
  try {
    s.fake.seed({ public_id: 'a/x' });
    s.fake.seed({ public_id: 'root' });
    const r = await s.tool('cloudinary_delete', { target: '*', recursive: true });
    assert.equal(r.data.needs_confirmation, true);
    assert.equal(r.data.plan.root_wide, true);
    assert.equal(r.data.plan.totals.assets, 2);
    assert.deepEqual(s.mutations(), []);
  } finally { s.done(); }
});

test('delete dry_run never returns a token and changes nothing', async () => {
  const s = await setup();
  try {
    s.fake.seed({ public_id: 'a/x' });
    const r = await s.tool('cloudinary_delete', { target: 'a/x', dry_run: true });
    assert.equal(r.data.dry_run, true);
    assert.equal(r.data.confirm_token, undefined);
    assert.equal(r.data.plan.totals.assets, 1);
    assert.deepEqual(s.mutations(), []);
  } finally { s.done(); }
});

test('tokens are rejected after expiry, for other arguments, other tools and another account', async () => {
  const s = await setup();
  try {
    s.fake.seed({ public_id: 'a/x' });
    s.fake.seed({ public_id: 'a/y' });
    const token = async () => (await s.tool('cloudinary_delete', { target: 'a', recursive: true })).data.confirm_token;

    const expired = await token();
    s.clock.t += 301_000;
    const r1 = await s.tool('cloudinary_delete', { target: 'a', recursive: true, confirm_token: expired });
    assert.equal(r1.ok, false);
    assert.match(r1.error.message, /expired/);

    const t2 = await token();
    const r2 = await s.tool('cloudinary_delete', { target: 'a/x', confirm_token: t2 });
    assert.equal(r2.ok, false);
    assert.match(r2.error.message, /does not match/);

    const r3 = await s.tool('cloudinary_move', { source: 'a/x', target: 'a/q', confirm_token: t2 });
    assert.equal(r3.ok, false);
    assert.match(r3.error.message, /issued for cloudinary_delete/);

    const t4 = await token();
    applyCredentials({ cloud_name: 'other-cloud', api_key: '222', api_secret: 'secret2', source: 'test' });
    const r4 = await s.tool('cloudinary_delete', { target: 'a', recursive: true, confirm_token: t4 });
    assert.equal(r4.ok, false);
    assert.equal(r4.error.code, 'CONFLICT');
    assert.match(r4.error.message, /account changed/);

    assert.deepEqual(s.mutations(), []);
    assert.equal(s.ids().length, 2);
  } finally { s.done(); }
});

test('--no-confirm: delete runs in one call', async () => {
  const s = await setup({ noConfirm: true });
  try {
    s.fake.seed({ public_id: 'a/x' });
    const r = await s.tool('cloudinary_delete', { target: 'a/x' });
    assert.equal(r.data.summary.deleted, 1);
    assert.deepEqual(s.ids(), []);
  } finally { s.done(); }
});

test('delete of something that does not exist reports not_found without a token', async () => {
  const s = await setup();
  try {
    const r = await s.tool('cloudinary_delete', { target: 'ghost' });
    assert.equal(r.data.confirm_token, undefined);
    assert.equal(r.data.summary.not_found, 1);
  } finally { s.done(); }
});

// ---------------------------------------------------------------- move and rename_folder

test('move: two-step; the preview names the URL change and an existing target', async () => {
  const s = await setup();
  try {
    s.fake.seed({ public_id: 'a/x' });
    s.fake.seedFolder('b');
    const first = await s.tool('cloudinary_move', { source: 'a/x', target: 'b/' });
    assert.equal(first.data.needs_confirmation, true);
    assert.equal(first.data.plan.urlChanged, false);
    assert.deepEqual(s.mutations(), []);
    const done = await s.tool('cloudinary_move', { source: 'a/x', target: 'b/', confirm_token: first.data.confirm_token });
    assert.ok(done.ok, done.text);
    assert.equal(s.fake.state.assets[0].asset_folder, 'b');

    s.fake.seed({ public_id: 'c/one' });
    s.fake.seed({ public_id: 'c/two' });
    const clash = await s.tool('cloudinary_move', { source: 'c/one', target: 'c/two', change_public_id: true, overwrite: true });
    assert.equal(clash.data.plan.targetExists, true);
    assert.equal(clash.data.plan.urlChanged, true);
    assert.match(clash.data.plan_summary, /Replaces the existing/);
  } finally { s.done(); }
});

test('rename_folder: two-step in dynamic mode, unsupported in fixed mode', async () => {
  const s = await setup();
  try {
    s.fake.seed({ public_id: 'old/x' });
    const first = await s.tool('cloudinary_rename_folder', { from: 'old', to: 'new' });
    assert.equal(first.data.needs_confirmation, true);
    const done = await s.tool('cloudinary_rename_folder', { from: 'old', to: 'new', confirm_token: first.data.confirm_token });
    assert.ok(done.ok, done.text);
    assert.ok(s.fake.state.folders.includes('new'));
  } finally { s.done(); }
  const f = await setup({ folderMode: 'fixed' });
  try {
    f.fake.seed({ public_id: 'old/x' });
    const r = await f.tool('cloudinary_rename_folder', { from: 'old', to: 'new' });
    assert.equal(r.error.code, 'UNSUPPORTED');
  } finally { f.done(); }
});

// ---------------------------------------------------------------- mkdir, account

test('mkdir creates folders from the root; account reports cloud, mode, source, rate limit, server settings', async () => {
  const s = await setup({ noConfirm: true });
  try {
    assert.deepEqual((await s.tool('cloudinary_mkdir', { folder: '/x/y' })).data, { created: 'x/y' });
    assert.ok(s.fake.state.folders.includes('x/y'));
    const a = (await s.tool('cloudinary_account')).data;
    assert.equal(a.cloud_name, 'fake-cloud');
    assert.equal(a.folder_mode, 'dynamic');
    assert.equal(a.credential_source, 'environment (CLOUDINARY_URL)');
    assert.equal(typeof a.rate_limit.remaining, 'number');
    assert.equal(a.server.confirmation, 'off');
    assert.deepEqual(a.server.allowed_local_paths, [s.project]);
    assert.ok(!JSON.stringify(a).includes('secret'));
  } finally { s.done(); }
});

// ---------------------------------------------------------------- upload through the sandbox

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] upload inside the working directory works; overwriting needs a token; overwrite:false skips`, async () => {
    const s = await setup({ folderMode: mode });
    try {
      s.write('pic.png');
      const created = await s.tool('cloudinary_upload', { local_path: 'pic.png', folder: 'shots' });
      assert.ok(created.ok, created.text);
      assert.equal(created.data.items[0].status, 'created');
      assert.deepEqual(s.ids(), ['shots/pic']);

      const preview = await s.tool('cloudinary_upload', { local_path: 'pic.png', folder: 'shots', dry_run: true });
      assert.equal(preview.data.items[0].exists, true);
      assert.equal(preview.data.confirm_token, undefined);

      const uploadsBefore = s.fake.calls.filter(c => c.method === 'upload').length;
      const ask = await s.tool('cloudinary_upload', { local_path: 'pic.png', folder: 'shots' });
      assert.equal(ask.data.needs_confirmation, true);
      assert.equal(ask.data.plan.overwrites, 1);
      assert.equal(s.fake.calls.filter(c => c.method === 'upload').length, uploadsBefore);

      const over = await s.tool('cloudinary_upload', { local_path: 'pic.png', folder: 'shots', confirm_token: ask.data.confirm_token });
      assert.equal(over.data.items[0].status, 'overwritten');

      const skip = await s.tool('cloudinary_upload', { local_path: 'pic.png', folder: 'shots', overwrite: false });
      assert.equal(skip.data.items[0].status, 'skipped');
      assert.deepEqual(s.ids(), ['shots/pic']);
    } finally { s.done(); }
  });
}

test('sandbox: ~/.ssh, config dir, ../outside, symlink escapes and hidden paths are refused', async () => {
  const s = await setup({ allow: [] });
  try {
    // The whole home is an allowed root here, so only the always-refused rules apply to ~/.ssh and the config dir.
    s.sandbox.addRoot(s.home);
    fs.mkdirSync(path.join(s.home, '.ssh'));
    fs.writeFileSync(path.join(s.home, '.ssh', 'id_rsa'), 'PRIVATE KEY');
    fs.mkdirSync(path.join(s.home, '.config', 'cldsh'), { recursive: true });
    fs.writeFileSync(path.join(s.home, '.config', 'cldsh', 'credentials.json'), '{}');
    const outside = fs.realpathSync(tempDir('cldsh-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.png'), PNG);
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(s.project, 'escape.png'));
    fs.symlinkSync(path.join(s.home, '.ssh'), path.join(s.project, 'keys'));
    s.write('.env', 'X=1');
    s.write('.git/config.png');
    s.write('dir/ok.png');

    const refused = [
      '~/.ssh/id_rsa',
      path.join(s.home, '.ssh', 'id_rsa'),
      'keys/id_rsa',
      '~/.config/cldsh/credentials.json',
      path.join(outside, 'secret.png'),
      '../../' + path.basename(outside) + '/secret.png',
      'escape.png',
    ];
    for (const p of refused) {
      const r = await s.tool('cloudinary_upload', { local_path: p, resource_type: 'raw' });
      assert.equal(r.ok, false, p);
      assert.equal(r.error.code, 'FORBIDDEN', `${p}: ${r.text}`);
    }
    assert.equal(s.fake.calls.filter(c => /upload/.test(c.method)).length, 0);

    // Hidden paths only when named explicitly; directory uploads skip them.
    const hidden = await s.tool('cloudinary_upload', { local_path: '.git/config.png', dry_run: true });
    assert.ok(hidden.ok, hidden.text);
    const env = await s.tool('cloudinary_upload', { local_path: '.env', dry_run: true });
    assert.ok(env.ok, env.text);
    const dir = await s.tool('cloudinary_upload', { local_path: '.', recursive: true, dry_run: true });
    assert.ok(dir.ok, dir.text);
    // Symlinks (escape.png, keys/) and hidden entries (.env, .git/) are not walked.
    assert.deepEqual(dir.data.items.map(i => i.file), ['dir/ok.png']);
  } finally { s.done(); }
});

test('sandbox unit: realpath, non-existing targets, hidden segments', () => {
  const home = fs.realpathSync(tempDir('cldsh-sbx-home-'));
  const base = path.join(home, 'p');
  fs.mkdirSync(path.join(base, 'a'), { recursive: true });
  const sb = createSandbox({ base, home, configDir: path.join(home, '.config', 'cldsh') });
  assert.equal(sb.resolve('a'), path.join(base, 'a'));
  assert.equal(sb.resolve('new/dir/file.png'), path.join(base, 'new', 'dir', 'file.png'));
  assert.throws(() => sb.resolve('..'), e => e.code === 'FORBIDDEN');
  assert.throws(() => sb.resolve('missing.png', { mustExist: true }), e => e.code === 'NOT_FOUND');
  assert.equal(sb.allows(path.join(base, 'a', '.hidden'), path.join(base, 'a')), false);
  assert.equal(sb.allows(path.join(base, 'a', '.hidden'), path.join(base, 'a', '.hidden')), true);
  assert.throws(() => sb.addRoot(path.join(home, 'nope')), e => e.code === 'USAGE');
});

// ---------------------------------------------------------------- client roots

test('client roots: requested after initialized, used for the sandbox, refreshed on list_changed', async () => {
  const s = await setup({ capabilities: { roots: { listChanged: true } } });
  try {
    const extra = fs.realpathSync(tempDir('cldsh-root-'));
    fs.writeFileSync(path.join(extra, 'r.png'), PNG);

    await s.server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const req = s.sent.find(m => m.method === 'roots/list');
    assert.ok(req, 'server asked for roots');
    // A tool call made before the answer waits for it.
    const pending = s.tool('cloudinary_upload', { local_path: path.join(extra, 'r.png'), dry_run: true });
    await s.server.handleMessage({ jsonrpc: '2.0', id: req.id, result: { roots: [{ uri: pathToFileURL(extra).href, name: 'extra' }] } });
    const r = await pending;
    assert.ok(r.ok, r.text);

    await s.server.handleMessage({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
    const req2 = s.sent.filter(m => m.method === 'roots/list')[1];
    await s.server.handleMessage({ jsonrpc: '2.0', id: req2.id, result: { roots: [] } });
    const r2 = await s.tool('cloudinary_upload', { local_path: path.join(extra, 'r.png'), dry_run: true });
    assert.equal(r2.error.code, 'FORBIDDEN');
  } finally { s.done(); }
});

// ---------------------------------------------------------------- download through the sandbox

test('download: never overwrites without overwrite:true; destinations outside the roots are refused', async () => {
  const s = await setup();
  try {
    s.fake.seed({ public_id: 'a/x', content: Buffer.from('REMOTE').toString('base64') });
    const first = await s.tool('cloudinary_download', { public_id: 'a/x', destination: 'out/' });
    assert.ok(first.ok, first.text);
    assert.equal(first.data.items[0].status, 'downloaded');
    const file = path.join(s.project, 'out', 'x.png');
    assert.equal(fs.readFileSync(file, 'utf8'), 'REMOTE');

    fs.writeFileSync(file, 'LOCAL');
    const second = await s.tool('cloudinary_download', { public_id: 'a/x', destination: 'out/' });
    assert.equal(second.data.items[0].status, 'skipped');
    assert.equal(fs.readFileSync(file, 'utf8'), 'LOCAL');

    const third = await s.tool('cloudinary_download', { public_id: 'a/x', destination: 'out/', overwrite: true });
    assert.equal(third.data.items[0].status, 'downloaded');
    assert.equal(fs.readFileSync(file, 'utf8'), 'REMOTE');

    for (const dest of ['../elsewhere/', '~/.ssh/']) {
      const r = await s.tool('cloudinary_download', { public_id: 'a/x', destination: dest });
      assert.equal(r.error?.code, 'FORBIDDEN', dest);
    }
    assert.ok(!fs.existsSync(path.join(s.home, 'elsewhere')));
  } finally { s.done(); }
});
