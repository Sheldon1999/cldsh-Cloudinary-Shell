import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { createSession, createContext } from '../lib/cli.js';
import { createOutput } from '../lib/output.js';
import { parseArgs } from '../lib/parse.js';
import { toCldError, EXIT } from '../lib/errors.js';
import * as rm from '../commands/rm.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { runCli } from './helpers/cli.js';

const sink = () => { const s = { text: '', write(x) { s.text += x; } }; return s; };

/**
 * Run `rm` in-process the way the dispatcher does, with a session cwd and a scripted prompter.
 * `answers` are returned by ask/confirm in order; `interactive: false` simulates a run without a terminal.
 */
async function runRm(backend, tokens, { cwd = '', interactive = true, answers = [] } = {}) {
  const session = createSession('repl');
  if (cwd) session.setCwd(cwd);
  const stdout = sink();
  const stderr = sink();
  const out = createOutput({ stdout, stderr });
  const asked = [];
  const prompter = {
    interactive,
    async ask(q) { asked.push(q); return String(answers.shift() ?? ''); },
    async askSecret(q) { asked.push(q); return String(answers.shift() ?? ''); },
    async confirm(q) { asked.push(q); return answers.shift() === true; },
  };
  let code;
  try {
    const { args, flags } = parseArgs(tokens, rm.spec);
    out.json = Boolean(flags.json);
    const ctx = createContext(session, { out, prompter, flags });
    ctx.backend = async () => backend;
    const result = await rm.default(ctx, args, flags);
    if (flags.json) out.data(result);
    else rm.render(result, ctx);
    code = ctx.exitCode;
  } catch (e) {
    const err = toCldError(e);
    out.error(err.message);
    code = err.exitCode;
  }
  return { code, stdout: stdout.text, stderr: stderr.text, asked, session };
}

function setup(folderMode) {
  const fake = createFakeCloudinary({ folderMode });
  const restore = installFake(cloudinary, fake);
  const backend = new Backend({ mode: folderMode, cloudName: 'fake-cloud' });
  return { fake, backend, restore };
}

const ids = (fake) => fake.state.assets.map(a => a.public_id).sort();

for (const mode of ['dynamic', 'fixed']) {
  test(`[${mode}] rm sub/a and rm ../a resolve against the session folder, without a prompt`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/sub/a' });
      fake.seed({ public_id: 'sub/a' });
      fake.seed({ public_id: 'a' });
      const r1 = await runRm(backend, ['sub/a'], { cwd: 'apps' });
      assert.equal(r1.code, EXIT.OK);
      assert.deepEqual(r1.asked, []);
      assert.deepEqual(ids(fake), ['a', 'sub/a']);
      const r2 = await runRm(backend, ['../a'], { cwd: 'apps' });
      assert.equal(r2.code, EXIT.OK);
      assert.deepEqual(ids(fake), ['sub/a']);
      assert.match(r2.stdout, /Deleted 1 · not found 0 · failed 0/);
    } finally { restore(); }
  });

  test(`[${mode}] rm ghost reports not found and exits 3`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'apps/a' });
      const r = await runRm(backend, ['ghost'], { cwd: 'apps' });
      assert.equal(r.code, EXIT.PARTIAL);
      assert.match(r.stdout, /not found\s+ghost/);
      assert.doesNotMatch(r.stdout, /\bok\b|deleted\s+/);
      assert.match(r.stdout, /Deleted 0 · not found 1 · failed 0/);
    } finally { restore(); }
  });

  test(`[${mode}] a failed folder delete is shown as failed and exits 3`, async () => {
    const { fake, backend, restore } = setup(mode);
    try {
      fake.seed({ public_id: 'old/a' });
      fake.seedFolder('old');
      fake.failNext('delete_folder', { error: { error: { message: 'Folder is not empty', http_code: 400 } } });
      const r = await runRm(backend, ['-rf', 'old', '-y']);
      assert.equal(r.code, EXIT.PARTIAL);
      assert.match(r.stdout, /failed\s+old\/: Folder is not empty/);
      assert.match(r.stderr, /--skip-backup/);
      assert.match(r.stdout, /Deleted 1 · not found 0 · failed 0 · folders deleted 0 · folders failed 1/);
    } finally { restore(); }
  });
}

test('recursive delete asks y/N; "no" deletes nothing, "yes" deletes', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'old/a' });
    const no = await runRm(backend, ['-r', 'old'], { answers: [false] });
    assert.equal(no.code, EXIT.ABORTED);
    assert.equal(no.asked.length, 1);
    assert.match(no.stderr, /"fake-cloud"/);
    assert.equal(fake.state.assets.length, 1);
    const yes = await runRm(backend, ['-r', 'old'], { answers: [true] });
    assert.equal(yes.code, EXIT.OK);
    assert.equal(fake.state.assets.length, 0);
    assert.ok(!fake.state.folders.includes('old'));
  } finally { restore(); }
});

test('wildcards and more than 20 assets ask; --yes skips the question', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    for (let i = 0; i < 21; i++) fake.seed({ public_id: `apps/a${i}` });
    fake.seed({ public_id: 'apps/cldlogo' });
    const glob = await runRm(backend, ['cld*'], { cwd: 'apps', answers: [false] });
    assert.equal(glob.code, EXIT.ABORTED);
    assert.equal(glob.asked.length, 1);
    const bulk = await runRm(backend, Array.from({ length: 21 }, (_, i) => `a${i}`), { cwd: 'apps', answers: [false] });
    assert.equal(bulk.code, EXIT.ABORTED);
    assert.equal(fake.state.assets.length, 22);
    const skip = await runRm(backend, ['cld*', '--yes'], { cwd: 'apps' });
    assert.equal(skip.code, EXIT.OK);
    assert.deepEqual(skip.asked, []);
    assert.equal(fake.state.assets.length, 21);
  } finally { restore(); }
});

test('emptying the whole account requires typing the cloud name', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'top' });
    fake.seed({ public_id: 'apps/a' });
    const wrong = await runRm(backend, ['-rf', '/'], { answers: ['y'] });
    assert.equal(wrong.code, EXIT.ABORTED);
    assert.match(wrong.asked[0], /fake-cloud/);
    assert.equal(fake.state.assets.length, 2);
    const right = await runRm(backend, ['-rf', '..'], { cwd: 'apps', answers: ['fake-cloud'] });
    assert.equal(right.code, EXIT.OK);
    assert.deepEqual(fake.state.assets, []);
    assert.equal(right.session.cwd, '');
  } finally { restore(); }
});

test('without a terminal a recursive delete refuses with exit 4 and prints the plan', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'old/a' });
    const r = await runRm(backend, ['-rf', 'old'], { interactive: false });
    assert.equal(r.code, EXIT.ABORTED);
    assert.match(r.stderr, /Delete 1 asset/);
    assert.equal(fake.state.assets.length, 1);
  } finally { restore(); }
});

test('--dry-run lists the plan and deletes nothing, without asking', async () => {
  const { fake, backend, restore } = setup('dynamic');
  try {
    fake.seed({ public_id: 'old/a' });
    fake.seed({ public_id: 'old/sub/b' });
    const r = await runRm(backend, ['-rf', 'old', '--dry-run'], { interactive: false });
    assert.equal(r.code, EXIT.OK);
    assert.match(r.stdout, /old\/a/);
    assert.match(r.stdout, /old\/sub\/b/);
    assert.match(r.stdout, /folder old\//);
    assert.equal(fake.state.assets.length, 2);
    assert.ok(!fake.calls.some(c => /^delete/.test(c.method)));
  } finally { restore(); }
});

// ---------------------------------------------------------------- headless binary

test('headless: rm -rf without --yes and no terminal exits 4 and deletes nothing', async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'old/a' });
  const r = await runCli(['rm', '-rf', 'old'], { fake });
  assert.equal(r.code, EXIT.ABORTED);
  assert.match(r.stderr, /--yes/);
  assert.equal(r.state.assets.length, 1);
  assert.ok(!r.calls.some(c => /^delete/.test(c.method)));
});

test('headless: rm -r folder --yes deletes the folder and prints a truthful summary', async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'old/a' });
  fake.seed({ public_id: 'old/sub/b', resource_type: 'raw' });
  fake.seed({ public_id: 'keep/c' });
  const r = await runCli(['rm', '-r', 'old', '--yes'], { fake });
  assert.equal(r.code, EXIT.OK, r.stderr);
  assert.deepEqual(r.state.assets.map(a => a.public_id), ['keep/c']);
  assert.ok(!r.state.folders.includes('old'));
  assert.match(r.stdout, /Deleted 2 · not found 0 · failed 0 · folders deleted 1 · folders failed 0/);
});

test('headless: rm ghost --json exits 3 with per-item statuses', async () => {
  const fake = createFakeCloudinary({ folderMode: 'fixed' });
  fake.seed({ public_id: 'a' });
  const r = await runCli(['rm', 'a', 'ghost', '--json'], { fake, env: { CLDSH_FAKE_MODE: 'fixed' } });
  assert.equal(r.code, EXIT.PARTIAL);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.items.map(i => [i.public_id, i.status]), [['ghost', 'not_found'], ['a', 'deleted']]);
  assert.deepEqual(out.summary, { deleted: 1, not_found: 1, failed: 0, folders_deleted: 0, folders_failed: 0 });
});

test("headless: rm 'cld*' --dry-run --json returns the plan; matches by display name", async () => {
  const fake = createFakeCloudinary();
  fake.seed({ public_id: 'q9w8', display_name: 'cldlogo' });
  fake.seed({ public_id: 'other' });
  const r = await runCli(['rm', 'cld*', '--dry-run', '--json'], { fake });
  assert.equal(r.code, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.dry_run, true);
  assert.deepEqual(out.plan.assets.map(a => a.public_id), ['q9w8']);
  assert.equal(r.state.assets.length, 2);
});
