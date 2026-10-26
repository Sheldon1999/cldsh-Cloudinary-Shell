import {
  loadCredentialsStore,
  getCredentialsPath,
  maskSecret,
  setCurrentProfile,
  removeProfile,
} from '../lib/credentials.js';
import {
  getActiveConfig,
  applyCredentials,
  loadEnvAndConfig,
  resolveSources,
  setSessionProfile,
  getSessionProfile,
  strongerSourceAtNextStart,
} from '../lib/env.js';
import { peekBackend } from '../lib/backend/index.js';
import { notFound, usageError } from '../lib/errors.js';

export const spec = {
  name: 'config',
  usage: 'config [ls | use <profile> | rm <profile>]',
  summary: 'Show the active account, list, switch or remove saved profiles',
  flags: {},
  notes: [
    'config              show the active account, where it comes from and which sources it overrides',
    'config ls           list saved profiles (* = saved default)',
    'config use <name>   switch to a profile now and make it the saved default',
    'config rm <name>    delete a saved profile (disconnects if it is the active one)',
    'Order, strongest first: --profile / CLOUDINARY_PROFILE / config use or login in this shell; CLOUDINARY_URL or CLOUDINARY_* in the environment; ./.env; the saved default profile.',
  ],
};

const SUBCOMMANDS = {
  show: 'show',
  ls: 'ls', list: 'ls',
  use: 'use', switch: 'use',
  rm: 'rm', remove: 'rm', delete: 'rm',
};

function isActiveProfile(name) {
  const a = getActiveConfig();
  return Boolean(a && a.kind === 'profile' && a.profile === name);
}

function show() {
  const a = getActiveConfig();
  const configFile = getCredentialsPath();
  // Re-read the sources so problems (e.g. an unreadable credentials file) are current;
  // overrides are reported through `shadowed`.
  let warnings = [];
  try {
    warnings = resolveSources().problems;
  } catch {}
  if (!a) return { configured: false, config_file: configFile, warnings };
  const b = peekBackend();
  return {
    configured: true,
    source: a.source,
    profile: a.profile,
    cloud_name: a.cloud_name,
    api_key: a.api_key,
    api_secret: maskSecret(a.api_secret),
    ...(a.options && Object.keys(a.options).length ? { options: a.options } : {}),
    folder_mode: b && b.cloudName === a.cloud_name ? b.mode : null,
    config_file: configFile,
    shadowed: a.shadowed || [],
    warnings,
  };
}

function list() {
  const store = loadCredentialsStore();
  return {
    config_file: getCredentialsPath(),
    current_profile: store.current_profile,
    profiles: Object.entries(store.profiles).map(([name, p]) => ({
      name,
      cloud_name: p.cloud_name,
      api_key: p.api_key,
      default: name === store.current_profile,
      active: isActiveProfile(name),
    })),
  };
}

function use(name) {
  const store = loadCredentialsStore();
  const p = Object.hasOwn(store.profiles, name) ? store.profiles[name] : null;
  if (!p) throw notFound(`Profile "${name}" does not exist`, 'run "config ls" to see saved profiles');
  if (!p.cloud_name || !p.api_key || !p.api_secret) {
    throw notFound(`Profile "${name}" is incomplete`, `run "login ${name}" to save its credentials again`);
  }
  setCurrentProfile(name);
  setSessionProfile(name);
  const startup = loadEnvAndConfig();
  return {
    profile: name,
    cloud_name: startup.cloud_name,
    default: true,
    overridden_at_next_start_by: strongerSourceAtNextStart(name),
  };
}

function rm(name) {
  const active = isActiveProfile(name);
  const wasDefault = loadCredentialsStore().current_profile === name;
  if (!removeProfile(name)) throw notFound(`Profile "${name}" does not exist`, 'run "config ls" to see saved profiles');
  if (getSessionProfile() === name) setSessionProfile(null);
  if (active) applyCredentials(null);
  return { removed: name, was_default: wasDefault, disconnected: active };
}

export default async function config(_ctx, args) {
  const [sub = 'show', name, ...extra] = args;
  const action = SUBCOMMANDS[sub];
  if (!action) throw usageError(`Unknown config subcommand: ${sub}`, spec.usage);
  if (action === 'show' || action === 'ls') {
    if (name !== undefined) throw usageError(`config ${sub} takes no arguments`, spec.usage);
    return action === 'show' ? { action, ...show() } : { action, ...list() };
  }
  if (!name || extra.length) throw usageError(`config ${sub} needs one profile name`, spec.usage);
  return action === 'use' ? { action, ...use(name) } : { action, ...rm(name) };
}

function renderShow(r, { out }) {
  const { c } = out;
  if (!r.configured) {
    out.print(c.yellow('Not connected to a Cloudinary account. Run "login", or set CLOUDINARY_URL in the environment or a .env file.'));
    out.print(`  ${c.cyan('Config file:')}  ${c.dim(r.config_file)}`);
  } else {
    const row = (label, value) => out.print(`  ${c.cyan(label.padEnd(13))} ${value}`);
    out.print(c.bold('Active Cloudinary account:'));
    row('Cloud name:', c.bold(r.cloud_name));
    row('Source:', r.source);
    row('Profile:', r.profile);
    row('API key:', r.api_key);
    row('API secret:', r.api_secret);
    if (r.options) row('Options:', Object.entries(r.options).map(([k, v]) => `${k}=${v}`).join(', '));
    if (r.folder_mode) row('Folder mode:', r.folder_mode);
    row('Config file:', c.dim(r.config_file));
    if (r.shadowed.length) {
      out.print(c.bold('Overridden sources:'));
      for (const s of r.shadowed) out.print(`  ${s.source} (cloud ${s.cloud_name})`);
    }
  }
  for (const w of r.warnings) out.warn(w);
}

export function render(r, ctx) {
  const { out } = ctx;
  if (r.action === 'show') return renderShow(r, ctx);
  if (r.action === 'ls') {
    if (!r.profiles.length) {
      out.print(out.c.dim('No saved profiles. Run "login" to add one.'));
      return;
    }
    for (const p of r.profiles) {
      const mark = p.default ? out.c.green('* ') : '  ';
      out.print(`${mark}${out.c.cyan(p.name)}  cloud ${p.cloud_name}${p.active ? out.c.dim('  (active)') : ''}`);
    }
    return;
  }
  if (r.action === 'use') {
    out.success(`Now using cloud ${r.cloud_name} (profile ${r.profile}); it is also the saved default.`);
    const next = r.overridden_at_next_start_by;
    if (next) {
      out.warn(`Note: at the next start ${next.source} (cloud ${next.cloud_name}) takes precedence over the saved default; use --profile ${r.profile} to pick it.`);
    }
    return;
  }
  out.success(`Removed profile ${r.removed}.`);
  if (r.disconnected) out.warn('It was the active account: this session is now disconnected. Run "config use <profile>" or "login".');
  else if (r.was_default) out.print('There is no saved default profile now; run "config use <profile>" to pick one.');
}
