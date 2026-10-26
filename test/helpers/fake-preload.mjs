// Loaded with `node --import` in spawned-process tests (see test/helpers/cli.js).
// Installs the in-memory fake on the real SDK singleton and persists its state on exit,
// so tests can run the real `cldsh.js` binary and then inspect what happened.
import fs from 'node:fs';
import process from 'node:process';
import { v2 } from 'cloudinary';
import { createFakeCloudinary, installFake, installFetchShim } from './fake-cloudinary.js';

const statePath = process.env.CLDSH_FAKE_STATE;
const callsPath = process.env.CLDSH_FAKE_CALLS;

const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : undefined;
const fake = createFakeCloudinary({ state, folderMode: process.env.CLDSH_FAKE_MODE || 'dynamic', cloudName: process.env.CLDSH_FAKE_CLOUD || 'fake-cloud' });
installFake(v2, fake);
installFetchShim(fake);

process.on('exit', () => {
  if (statePath) fs.writeFileSync(statePath, JSON.stringify(fake.state));
  if (callsPath) fs.writeFileSync(callsPath, JSON.stringify(fake.calls));
});
