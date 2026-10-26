import { cloudinary } from '../lib/sdk.js';
import {
  parseCloudinaryUrl,
  saveProfile,
  loadCredentialsStore,
  backupCredentialsStore,
  getCredentialsPath,
} from '../lib/credentials.js';
import {
  applyCredentials,
  getActiveConfig,
  loadEnvAndConfig,
  setSessionProfile,
  getSessionProfile,
  strongerSourceAtNextStart,
} from '../lib/env.js';
import { readStdin } from '../lib/prompt.js';
import { CldshError, CODES, toCldError, usageError } from '../lib/errors.js';

const URL_FORMAT = 'expected cloudinary://<api_key>:<api_secret>@<cloud_name>';
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const spec = {
  name: 'login',
  usage: 'login [profile] [CLOUDINARY_URL] [--stdin] [--reset]',
  summary: 'Connect a Cloudinary account and save it as a profile',
  flags: {
    stdin: { type: 'boolean', description: 'Read the CLOUDINARY_URL from stdin' },
    reset: { type: 'boolean', description: 'Move an unreadable credentials file to credentials.json.bak and start a new one' },
  },
  notes: [
    'Without a URL, login asks for it (or for cloud name, API key and secret) on the terminal.',
    'In scripts: printf %s "$CLOUDINARY_URL" | cldsh login prod --stdin',
    'The credentials are checked with Cloudinary before they are saved; the profile becomes the saved default.',
  ],
};

function splitArgs(args) {
  if (args.length > 2) throw usageError('login takes at most a profile name and a URL', spec.usage);
  let [profile, url] = args;
  if (profile !== undefined && parseCloudinaryUrl(profile)) {
    if (url !== undefined) throw usageError('Put the profile name before the URL', spec.usage);
    url = profile;
    profile = undefined;
  }
  profile = profile ?? 'default';
  if (!PROFILE_NAME.test(profile)) {
    throw usageError(`Invalid profile name "${profile}"`, 'use letters, digits, "_", "-" and "." (max 64 characters)');
  }
  return { profile, url };
}

const invalidUrl = () => usageError('Invalid CLOUDINARY_URL', URL_FORMAT);

async function askCredentials(ctx) {
  const { prompter, out } = ctx;
  out.info('Paste your CLOUDINARY_URL (input is hidden), or press Enter to type cloud name, API key and secret.');
  const direct = await prompter.askSecret('CLOUDINARY_URL: ');
  if (direct) {
    const creds = parseCloudinaryUrl(direct);
    if (!creds) throw invalidUrl();
    return creds;
  }
  const cloud_name = await prompter.ask('Cloud name: ');
  const api_key = await prompter.ask('API key:    ');
  const api_secret = await prompter.askSecret('API secret: ');
  if (!cloud_name || !api_key || !api_secret) {
    throw new CldshError(CODES.ABORTED, 'Login cancelled: cloud name, API key and API secret are all required');
  }
  return { cloud_name, api_key, api_secret, options: {} };
}

async function getCredentials(ctx, url, flags) {
  if (flags.stdin) {
    if (url !== undefined) throw usageError('Pass the URL either as an argument or on stdin, not both', spec.usage);
    const input = (await readStdin()).trim();
    if (!input) throw usageError('--stdin: no CLOUDINARY_URL on stdin', 'e.g. printf %s "$CLOUDINARY_URL" | cldsh login prod --stdin');
    const creds = parseCloudinaryUrl(input);
    if (!creds) throw invalidUrl();
    return creds;
  }
  if (url !== undefined) {
    const creds = parseCloudinaryUrl(url);
    if (!creds) throw invalidUrl();
    if (ctx.session?.mode === 'headless') {
      ctx.out.warn('Warning: a URL on the command line is visible to other users in the process list and stays in your shell history. Prefer --stdin.');
    }
    return creds;
  }
  if (!ctx.interactive) {
    throw usageError('login needs a CLOUDINARY_URL', 'pipe it in: printf %s "$CLOUDINARY_URL" | cldsh login <profile> --stdin, or run login on a terminal');
  }
  return askCredentials(ctx);
}

export default async function login(ctx, args, flags) {
  const { profile, url } = splitArgs(args);
  const storePath = getCredentialsPath();

  // Refuse before asking anything when the store cannot be updated without losing data.
  if (!flags.reset) loadCredentialsStore(storePath);

  const creds = await getCredentials(ctx, url, flags);

  const previous = getActiveConfig();
  const previousSession = getSessionProfile();
  let backup = null;
  try {
    ctx.out.info(`Checking the credentials for cloud ${creds.cloud_name} with Cloudinary...`);
    applyCredentials({ ...creds, source: 'login (validating)', profile, kind: 'profile' });
    let res;
    try {
      res = await cloudinary.api.ping();
    } catch (e) {
      const err = toCldError(e);
      err.message = `Cloudinary rejected the credentials for cloud ${creds.cloud_name}: ${err.message}`;
      err.hint = 'Nothing was saved. Check the cloud name, API key and secret (Console > Settings > API Keys).';
      throw err;
    }
    if (res?.status !== 'ok') {
      throw new CldshError(CODES.AUTH, `Cloudinary did not confirm the credentials for cloud ${creds.cloud_name}`, { hint: 'Nothing was saved.' });
    }

    if (flags.reset) backup = backupCredentialsStore(storePath);
    saveProfile(profile, creds, true, storePath);
    setSessionProfile(profile);
    loadEnvAndConfig();
  } catch (e) {
    setSessionProfile(previousSession);
    applyCredentials(previous);
    throw e;
  }

  return {
    profile,
    cloud_name: creds.cloud_name,
    api_key: creds.api_key,
    options: creds.options,
    saved_to: storePath,
    ...(backup ? { backup } : {}),
    overridden_at_next_start_by: strongerSourceAtNextStart(profile),
  };
}

export function render(result, ctx) {
  const { out } = ctx;
  out.success(`Connected to cloud ${result.cloud_name} (profile ${result.profile}).`);
  out.print(`Saved as the default profile in ${result.saved_to}`);
  if (result.backup) out.print(`The previous credentials file was moved to ${result.backup}`);
  const next = result.overridden_at_next_start_by;
  if (next) {
    out.warn(`Note: at the next start ${next.source} (cloud ${next.cloud_name}) takes precedence over this profile; use --profile ${result.profile} or "config use ${result.profile}" to pick it.`);
  }
}
