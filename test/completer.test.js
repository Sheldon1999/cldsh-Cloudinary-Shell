import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinary, configureSdk } from '../lib/sdk.js';
import { Backend } from '../lib/backend/index.js';
import { CldshError, CODES } from '../lib/errors.js';
import { matchCompletions, createCompleter } from '../lib/completer.js';
import { createFakeCloudinary, installFake } from './helpers/fake-cloudinary.js';
import { COMMANDS as REGISTRY } from '../commands/index.js';

// A small registry with real-looking specs (the completer reads flags from them).
const spec = (name, flags = {}, aliases = []) => ({ spec: { name, flags, aliases } });
const view = spec('view', { t: { type: 'string' }, rt: { type: 'string', values: ['all', 'image', 'video', 'raw'] } }, ['preview']);
const COMMANDS = new Map([
  ['cd', spec('cd')],
  ['ls', spec('ls', { long: { type: 'boolean', short: 'l' } })],
  ['mkdir', spec('mkdir')],
  ['mv', spec('mv', { overwrite: { type: 'boolean', short: 'o' }, 'public-id': { type: 'boolean' } })],
  ['info', spec('info')],
  ['rm', spec('rm', { recursive: { type: 'boolean', short: 'r' } })],
  ['url', spec('url', { t: { type: 'string' }, signed: { type: 'boolean' } })],
  ['upload', spec('upload', { to: { type: 'string', placeholder: 'folder' } })],
  ['view', view],
  ['preview', view],
]);

test('commands: prefix matches include aliases and exit/quit', () => {
  assert.deepEqual(matchCompletions('', { commands: COMMANDS })[0].length, COMMANDS.size + 2);
  assert.deepEqual(matchCompletions('m', { commands: COMMANDS }), [['mkdir', 'mv'], 'm']);
  assert.deepEqual(matchCompletions('pre', { commands: COMMANDS }), [['preview'], 'pre']);
  assert.deepEqual(matchCompletions('q', { commands: COMMANDS }), [['quit'], 'q']);
});

test('flags come from the command spec (long, long=, short, values; aliases resolve)', () => {
  const [mvFlags] = matchCompletions('mv a b -', { commands: COMMANDS });
  assert.ok(mvFlags.includes('--overwrite') && mvFlags.includes('-o') && mvFlags.includes('--public-id'));
  assert.ok(mvFlags.includes('--json'), 'global flags too');
  assert.ok(!mvFlags.includes('--signed'));
  assert.deepEqual(matchCompletions('url hero --s', { commands: COMMANDS }), [['--signed'], '--s']);
  assert.deepEqual(matchCompletions('preview x --t', { commands: COMMANDS })[0], ['--t=']);
  assert.deepEqual(matchCompletions('preview x --rt=v', { commands: COMMANDS }), [['--rt=video'], '--rt=v']);
  assert.deepEqual(matchCompletions('view x --rt ', { commands: COMMANDS })[0], ['all', 'image', 'video', 'raw']);
  // The value of a value flag is not a path.
  assert.deepEqual(matchCompletions('url --t w', { commands: COMMANDS, folders: ['wide'], assets: ['wolf'] })[0], []);
});

test('the real command registry: flags and aliases come from the command specs', () => {
  assert.ok(matchCompletions('pre', { commands: REGISTRY })[0].includes('preview'));
  assert.deepEqual(matchCompletions('mv a b --pu', { commands: REGISTRY })[0], ['--public-id']);
  assert.ok(matchCompletions('preview x --', { commands: REGISTRY })[0].includes('--t='));
  assert.deepEqual(matchCompletions('cd a', { commands: REGISTRY, folders: ['apps'], assets: ['avatar'] })[0], ['apps/']);
});

test('paths: folders for cd/mkdir, folders and asset names for asset commands, nested prefixes kept', () => {
  const opts = { commands: COMMANDS, folders: ['apps', 'archive'], assets: ['avatar', 'hero'] };
  assert.deepEqual(matchCompletions('cd a', opts), [['apps/', 'archive/'], 'a']);
  assert.deepEqual(matchCompletions('info a', opts), [['apps/', 'archive/', 'avatar'], 'a']);
  assert.deepEqual(matchCompletions('cd /x/a', opts), [['/x/apps/', '/x/archive/'], '/x/a']);
  assert.deepEqual(matchCompletions('mv hero ../h', opts), [['../hero'], '../h']);
  assert.deepEqual(matchCompletions('upload f.png --to=a', opts), [['--to=apps/', '--to=archive/'], '--to=a']);
  assert.deepEqual(matchCompletions('upload f.png --to a', opts)[0], ['apps/', 'archive/']);
  assert.deepEqual(matchCompletions('unknown a', opts), [[], 'a']);
  // Names with spaces are offered escaped and matched escaped.
  assert.deepEqual(matchCompletions('info my\\ ', { commands: COMMANDS, assets: ['my file'] }), [['my\\ file'], 'my\\ ']);
});

function setup(t) {
  const fake = createFakeCloudinary({ folderMode: 'dynamic' });
  t.after(installFake(cloudinary, fake));
  configureSdk({ cloud_name: 'fake-cloud', api_key: '111', api_secret: 'secret' });
  const backend = new Backend({ mode: 'dynamic', cloudName: 'fake-cloud' });
  const session = { cwd: '' };
  const complete = (line, getBackend = async () => backend) => new Promise((resolve, reject) => {
    createCompleter({ session, getBackend, commands: COMMANDS })(line, (err, res) => (err ? reject(err) : resolve(res)));
  });
  return { fake, session, complete };
}

test('createCompleter: nested remote paths relative to the current folder, asset names from the backend', async (t) => {
  const { fake, session, complete } = setup(t);
  fake.seedFolder('apps/web');
  fake.seedFolder('apps/mobile');
  fake.seed({ public_id: 'apps/hero' });
  fake.seed({ public_id: 'apps/web/logo' });

  assert.deepEqual(await complete('cd apps/'), [['apps/mobile/', 'apps/web/'], 'apps/']);
  assert.deepEqual(await complete('info apps/'), [['apps/mobile/', 'apps/web/', 'apps/hero'], 'apps/']);
  assert.deepEqual(await complete('mkdir apps/'), [['apps/mobile/', 'apps/web/'], 'apps/']);

  session.cwd = 'apps';
  assert.deepEqual(await complete('rm web/l'), [['web/logo'], 'web/l']);
  assert.deepEqual(await complete('view /apps/h'), [['/apps/hero'], '/apps/h']);
  assert.deepEqual(await complete('cd ../a'), [['../apps/'], '../a']);

  // Listings are cached by the backend: completing in the same folder again costs no API call.
  const before = fake.calls.length;
  await complete('info mobile/');
  await complete('info mobile/x');
  assert.equal(fake.calls.length - before, 2, 'one folder listing and one asset listing');
});

test('createCompleter: errors and missing folders give no completions', async (t) => {
  const { complete } = setup(t);
  assert.deepEqual(await complete('cd nope/'), [[], 'nope/']);
  const offline = async () => { throw new CldshError(CODES.NOT_CONFIGURED, 'Not connected'); };
  assert.deepEqual(await complete('cd a', offline), [[], 'a']);
  assert.deepEqual(await complete('c', offline), [['cd'], 'c']);
});
