// Shell-session behavior (cd / pwd / lcd) through the real dispatcher, in-process, against the fake SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { Writable } from 'node:stream';
import { cloudinary } from '../lib/sdk.js';
import { createSession, dispatch } from '../lib/cli.js';
import { createOutput } from '../lib/output.js';
import { applyCredentials } from '../lib/env.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

async function shell(fake) {
  const restore = installFake(cloudinary, fake);
  applyCredentials({ cloud_name: `cloud-${Math.random()}`, api_key: 'k', api_secret: 's', profile: 'test', source: 'test' });
  const session = createSession('repl');
  const stdout = sink();
  const stderr = sink();
  const out = createOutput({ stdout: stdout.stream, stderr: stderr.stream });
  const run = (line) => dispatch(session, line.split(' '), { out, prompter: { interactive: false } });
  return { session, run, stdout, stderr, restore: () => { restore(); applyCredentials(null); } };
}

test('cd: relative, absolute, parent, previous; missing folder is an error and keeps the folder', async () => {
  const fake = createFakeCloudinary();
  fake.seedFolder('apps/my-app/assets');
  fake.seedFolder('other');
  const sh = await shell(fake);
  try {
    assert.equal(await sh.run('cd apps/my-app'), 0);
    assert.equal(sh.session.cwd, 'apps/my-app');
    assert.equal(await sh.run('cd ../../other'), 0);
    assert.equal(sh.session.cwd, 'other');
    assert.equal(await sh.run('cd -'), 0);
    assert.equal(sh.session.cwd, 'apps/my-app');
    assert.equal(await sh.run('cd /apps'), 0);
    assert.equal(sh.session.cwd, 'apps');
    assert.equal(await sh.run('cd nope'), 1);
    assert.equal(sh.session.cwd, 'apps');
    assert.match(sh.stderr.text, /No such folder: nope/);
    await sh.run('pwd');
    assert.match(sh.stdout.text, /^\/apps$/m);
  } finally { sh.restore(); }
});

test('cd into the 11th+ subfolder works (folder listings are paged)', async () => {
  const fake = createFakeCloudinary();
  for (let i = 0; i < 15; i++) fake.seedFolder(`apps/f${String(i).padStart(2, '0')}`);
  const sh = await shell(fake);
  try {
    assert.equal(await sh.run('cd apps/f14'), 0);
    assert.equal(sh.session.cwd, 'apps/f14');
  } finally { sh.restore(); }
});

test('lcd changes the local directory; a missing directory is an error', async () => {
  const fake = createFakeCloudinary();
  const sh = await shell(fake);
  const orig = process.cwd();
  try {
    const tmp = fs.realpathSync(os.tmpdir());
    assert.equal(await sh.run(`lcd ${tmp}`), 0);
    assert.equal(fs.realpathSync(process.cwd()), tmp);
    assert.equal(await sh.run('lcd /definitely/not/here'), 1);
    assert.equal(fs.realpathSync(process.cwd()), tmp);
  } finally {
    process.chdir(orig);
    sh.restore();
  }
});

test('--profile is rejected inside the shell', async () => {
  const sh = await shell(createFakeCloudinary());
  try {
    assert.equal(await sh.run('ls --profile prod'), 2);
    assert.match(sh.stderr.text, /config use/);
  } finally { sh.restore(); }
});
