// Run the real cldsh binary against the in-memory fake (test/helpers/fake-preload.mjs),
// with an isolated HOME so tests never read or write the developer's credentials or history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFakeCloudinary } from './fake-cloudinary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const BIN = path.join(ROOT, 'cldsh.js');
const PRELOAD = path.join(here, 'fake-preload.mjs');

export function tempDir(prefix = 'cldsh-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * @param {string[]} args argv passed to cldsh
 * @param {object} opts
 * @param {object} [opts.fake] a fake from createFakeCloudinary(); its state is passed to the child
 * @param {object} [opts.env] extra environment variables
 * @param {string} [opts.cwd] working directory (defaults to a fresh temp dir)
 * @param {string} [opts.home] HOME directory (defaults to a fresh temp dir)
 * @param {string} [opts.input] stdin contents
 * @param {boolean} [opts.credentials=true] set CLOUDINARY_URL for the fake cloud
 */
export function runCli(args, { fake, env = {}, cwd, home, input, credentials = true } = {}) {
  const dir = tempDir();
  const statePath = path.join(dir, 'state.json');
  const callsPath = path.join(dir, 'calls.json');
  const f = fake ?? createFakeCloudinary();
  fs.writeFileSync(statePath, JSON.stringify(f.state));
  const homeDir = home ?? tempDir('cldsh-home-');

  const childEnv = {
    PATH: process.env.PATH,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, 'AppData'),
    NO_COLOR: '1',
    CLDSH_FAKE_STATE: statePath,
    CLDSH_FAKE_CALLS: callsPath,
    CLDSH_FAKE_CLOUD: f.state.cloudName,
    ...(credentials ? { CLOUDINARY_URL: `cloudinary://111:secret@${f.state.cloudName}` } : {}),
    ...env,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, BIN, ...args], {
      cwd: cwd ?? tempDir('cldsh-cwd-'),
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
      const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, 'utf8')) : [];
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, stdout, stderr, state, calls, home: homeDir });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
