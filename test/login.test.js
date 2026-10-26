// login and config: spawned runs (temp HOME, fake SDK) and in-process runs for states the
// spawned fake cannot reach (rejected credentials, session switching).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Writable } from 'node:stream';
import { runCli, tempDir } from './helpers/cli.js';

// In-process parts must never see the developer's credentials, history or environment.
process.env.HOME = tempDir('cldsh-home-');
process.env.USERPROFILE = process.env.HOME;
process.env.APPDATA = path.join(process.env.HOME, 'AppData');
for (const k of ['CLOUDINARY_URL', 'CLOUDINARY_PROFILE', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[k];

const { createFakeCloudinary, installFake } = await import('./helpers/fake-cloudinary.js');
const { cloudinary } = await import('../lib/sdk.js');
const { createSession, dispatch } = await import('../lib/cli.js');
const { createOutput } = await import('../lib/output.js');
const { getCredentialsPath, saveProfile, loadCredentialsStore } = await import('../lib/credentials.js');
const { applyCredentials, getActiveConfig, loadEnvAndConfig, setSessionProfile } = await import('../lib/env.js');

const SECRET = 'topsecretvalue42';
const FAKE_URL = `cloudinary://111:${SECRET}@fake-cloud`;
const posix = process.platform !== 'win32';
const storeOf = (home) => path.join(home, '.config', 'cldsh', 'credentials.json');

// ---------------------------------------------------------------- spawned

test('headless login without URL and without a terminal is a usage error', async () => {
  const r = await runCli(['login'], { credentials: false });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--stdin/);
  assert.doesNotMatch(r.stderr, /TypeError|at .*\.js:\d+/);
  assert.equal(fs.existsSync(storeOf(r.home)), false);
});

test('login --stdin saves the profile; config shows it without the secret', { skip: !posix }, async () => {
  const r = await runCli(['login', 'it', '--stdin', '--json'], { credentials: false, input: `${FAKE_URL}\n` });
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
  const res = JSON.parse(r.stdout);
  assert.equal(res.profile, 'it');
  assert.equal(res.cloud_name, 'fake-cloud');
  assert.deepEqual(r.calls.map(c => c.method), ['ping']);

  const store = JSON.parse(fs.readFileSync(storeOf(r.home), 'utf8'));
  assert.equal(store.version, 2);
  assert.equal(store.current_profile, 'it');
  assert.equal(store.profiles.it.api_secret, SECRET);
  assert.equal(fs.statSync(storeOf(r.home)).mode & 0o777, 0o600);

  const show = await runCli(['config', '--json'], { credentials: false, home: r.home });
  assert.equal(show.code, 0, show.stderr);
  assert.doesNotMatch(show.stdout + show.stderr, new RegExp(SECRET));
  const cfg = JSON.parse(show.stdout);
  assert.equal(cfg.cloud_name, 'fake-cloud');
  assert.equal(cfg.profile, 'it');
  assert.equal(cfg.source, 'saved default profile "it"');

  const human = await runCli(['config'], { credentials: false, home: r.home });
  assert.match(human.stdout, /fake-cloud/);
  assert.doesNotMatch(human.stdout + human.stderr, new RegExp(SECRET));

  // A stronger source is shown as the active one, with the saved default listed as overridden.
  const env = await runCli(['config', '--json'], { credentials: false, home: r.home, env: { CLOUDINARY_URL: 'cloudinary://222:othersecret@other-cloud' } });
  const envCfg = JSON.parse(env.stdout);
  assert.equal(envCfg.cloud_name, 'other-cloud');
  assert.deepEqual(envCfg.shadowed, [{ source: 'saved default profile "it"', profile: 'it', cloud_name: 'fake-cloud' }]);
  assert.doesNotMatch(env.stdout, /othersecret/);

  const ls = await runCli(['config', 'ls', '--json'], { credentials: false, home: r.home });
  assert.deepEqual(JSON.parse(ls.stdout).profiles.map(p => [p.name, p.default]), [['it', true]]);
  assert.doesNotMatch(ls.stdout, new RegExp(SECRET));
});

test('login with the URL as an argument works but warns', async () => {
  const r = await runCli(['login', 'it', FAKE_URL], { credentials: false });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /process list/);
  assert.doesNotMatch(r.stdout, new RegExp(SECRET));
});

test('invalid URLs are rejected without echoing them', async () => {
  const r = await runCli(['login', 'it', '--stdin'], { credentials: false, input: `cloudinary://${SECRET}@` });
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.stderr, new RegExp(SECRET));
  assert.deepEqual(r.calls, []);
});

test('a corrupt credentials file blocks login until --reset moves it aside', { skip: !posix }, async () => {
  const home = tempDir('cldsh-home-');
  const file = storeOf(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"profiles": {"prod": {"cloud_name": "x"');

  const refused = await runCli(['login', 'it', '--stdin'], { credentials: false, home, input: FAKE_URL });
  assert.equal(refused.code, 1);
  assert.ok(refused.stderr.includes(file), refused.stderr);
  assert.match(refused.stderr, /--reset/);
  assert.deepEqual(refused.calls, []);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"profiles": {"prod": {"cloud_name": "x"');

  const reset = await runCli(['login', 'it', '--stdin', '--reset'], { credentials: false, home, input: FAKE_URL });
  assert.equal(reset.code, 0, reset.stderr);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), '{"profiles": {"prod": {"cloud_name": "x"');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).profiles), ['it']);
});

test('shell: a login line never reaches the history file, which is kept at 0600', { skip: !posix }, async () => {
  const home = tempDir('cldsh-home-');
  const hist = path.join(home, '.cldsh_history');
  fs.writeFileSync(hist, 'ls\nlogin old cloudinary://k:s@c\n', { mode: 0o644 });
  fs.chmodSync(hist, 0o644);
  const r = await runCli([], { credentials: false, home, input: `login default ${FAKE_URL}\n` });
  assert.equal(r.code, 0, r.stderr);
  const text = fs.readFileSync(hist, 'utf8');
  assert.doesNotMatch(text, /cloudinary:\/\//);
  assert.doesNotMatch(text, /^login/m);
  assert.equal(fs.statSync(hist).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(storeOf(home), 'utf8')).current_profile, 'default');
});

// ---------------------------------------------------------------- in-process

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

async function run(tokens, { session = createSession('repl'), prompter = { interactive: false } } = {}) {
  const stdout = sink();
  const stderr = sink();
  const out = createOutput({ stdout: stdout.stream, stderr: stderr.stream });
  const realWrite = process.stderr.write;
  // dispatch prints JSON errors straight to process.stderr.
  process.stderr.write = (s) => { stderr.stream.write(s); return true; };
  try {
    const code = await dispatch(session, tokens, { out, prompter });
    return { code, stdout: stdout.text, stderr: stderr.text };
  } finally {
    process.stderr.write = realWrite;
  }
}

function freshState() {
  fs.rmSync(path.dirname(getCredentialsPath()), { recursive: true, force: true });
  setSessionProfile(null);
  applyCredentials(null);
  const cwd = tempDir('cldsh-cwd-');
  process.chdir(cwd);
  return cwd;
}

const PREV = { cloud_name: 'old-cloud', api_key: 'old-key', api_secret: 'old-secret', options: {}, source: 'test', profile: 'old', kind: 'profile' };

test('login with rejected credentials restores the previous account and saves nothing', async (t) => {
  freshState();
  const fake = createFakeCloudinary();
  t.after(installFake(cloudinary, fake));
  saveProfile('old', PREV, true);
  const before = fs.readFileSync(getCredentialsPath(), 'utf8');
  applyCredentials(PREV);

  fake.failNext('ping', { error: { error: { message: 'Invalid api_key new-key', http_code: 401 } } });
  const r = await run(['login', 'new', 'cloudinary://new-key:new-secret@new-cloud']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /new-cloud/);
  assert.match(r.stderr, /Nothing was saved/);
  assert.equal(fs.readFileSync(getCredentialsPath(), 'utf8'), before);
  assert.equal(getActiveConfig().cloud_name, 'old-cloud');
  assert.equal(cloudinary.config().cloud_name, 'old-cloud');
  assert.equal(cloudinary.config().api_secret, 'old-secret');

  // From a disconnected start, a failed login leaves the session disconnected and no file behind.
  freshState();
  fake.failNext('ping', { error: { error: { message: 'Invalid api_key', http_code: 401 } } });
  const r2 = await run(['login', 'cloudinary://new-key:new-secret@new-cloud']);
  assert.equal(r2.code, 1);
  assert.equal(getActiveConfig(), null);
  assert.equal(cloudinary.config().cloud_name, undefined);
  assert.equal(fs.existsSync(getCredentialsPath()), false);
});

test('interactive login asks for the URL as a secret and switches the session', async (t) => {
  freshState();
  const fake = createFakeCloudinary();
  t.after(installFake(cloudinary, fake));
  const asked = [];
  const prompter = {
    interactive: true,
    async ask(q) { asked.push(['ask', q]); return ({ 'Cloud name: ': 'typed-cloud', 'API key:    ': 'typed-key' })[q]; },
    async askSecret(q) { asked.push(['secret', q]); return q.startsWith('CLOUDINARY_URL') ? '' : 'typed-secret'; },
  };
  const r = await run(['login', 'work', '--json'], { prompter });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(asked.map(a => a[0]), ['secret', 'ask', 'ask', 'secret']);
  assert.doesNotMatch(r.stdout, /typed-secret/);
  assert.equal(getActiveConfig().cloud_name, 'typed-cloud');
  assert.equal(getActiveConfig().profile, 'work');
  assert.equal(loadCredentialsStore().profiles.work.api_secret, 'typed-secret');
});

test('config use wins over .env for the session; config rm of the active profile disconnects', async (t) => {
  const cwd = freshState();
  const fake = createFakeCloudinary();
  t.after(installFake(cloudinary, fake));
  saveProfile('dev', { cloud_name: 'dev-cloud', api_key: 'dk', api_secret: 'dev-secret' }, true);
  saveProfile('prod', { cloud_name: 'prod-cloud', api_key: 'pk', api_secret: 'prod-secret' }, false);
  fs.writeFileSync(path.join(cwd, '.env'), 'CLOUDINARY_URL=cloudinary://ek:env-secret@env-cloud\n');
  const startup = loadEnvAndConfig();
  assert.equal(startup.cloud_name, 'env-cloud');

  const use = await run(['config', 'use', 'prod', '--json']);
  assert.equal(use.code, 0, use.stderr);
  const res = JSON.parse(use.stdout);
  assert.equal(res.cloud_name, 'prod-cloud');
  assert.equal(res.overridden_at_next_start_by.cloud_name, 'env-cloud');
  assert.equal(getActiveConfig().cloud_name, 'prod-cloud');
  assert.equal(cloudinary.config().cloud_name, 'prod-cloud');
  assert.equal(loadCredentialsStore().current_profile, 'prod');

  const human = await run(['config', 'use', 'prod']);
  assert.match(human.stdout, /prod-cloud/);
  assert.match(human.stderr, /\.env.*env-cloud/);

  const show = await run(['config', '--json']);
  const cfg = JSON.parse(show.stdout);
  assert.equal(cfg.cloud_name, 'prod-cloud');
  assert.deepEqual(cfg.shadowed.map(s => s.cloud_name), ['env-cloud']);
  assert.doesNotMatch(show.stdout, /prod-secret|env-secret|dev-secret/);

  const rmOther = await run(['config', 'rm', 'dev', '--json']);
  assert.equal(JSON.parse(rmOther.stdout).disconnected, false);
  assert.equal(getActiveConfig().cloud_name, 'prod-cloud');

  const rm = await run(['config', 'rm', 'prod', '--json']);
  assert.equal(rm.code, 0, rm.stderr);
  assert.deepEqual(JSON.parse(rm.stdout), { action: 'rm', removed: 'prod', was_default: true, disconnected: true });
  assert.equal(getActiveConfig(), null);
  assert.equal(cloudinary.config().cloud_name, undefined);
  const store = loadCredentialsStore();
  assert.equal(store.current_profile, null);
  assert.deepEqual(store.profiles, {});

  const missing = await run(['config', 'use', 'prod']);
  assert.equal(missing.code, 1);
  assert.equal(getActiveConfig(), null);
});
