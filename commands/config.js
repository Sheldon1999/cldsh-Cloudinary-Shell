import chalk from 'chalk';
import {
  loadCredentialsStore,
  getCredentialsPath,
  maskSecret,
  setCurrentProfile,
  removeProfile,
} from '../lib/credentials.js';
import { getActiveConfig, applyCredentials, resolveCredentials } from '../lib/env.js';

export default async function configCmd(ctx, args = [], _flags = {}) {
  const { printer } = ctx;
  const subCmd = args[0];

  // 1. config ls / config list
  if (subCmd === 'ls' || subCmd === 'list') {
    const store = loadCredentialsStore();
    const profiles = Object.keys(store.profiles);
    if (!profiles.length) {
      printer.println(printer.dim('No saved profiles found. Run "login" to add one.'));
      return;
    }
    printer.println(chalk.bold('\nSaved Profiles:'));
    for (const p of profiles) {
      const active = p === store.current_profile ? chalk.green('* ') : '  ';
      const cloud = store.profiles[p]?.cloud_name || 'unknown';
      printer.println(`${active}${chalk.cyan(p)} (cloud: ${cloud})`);
    }
    printer.println('');
    return;
  }

  // 2. config use <profile>
  if (subCmd === 'use' || subCmd === 'switch') {
    const targetProfile = args[1];
    if (!targetProfile) {
      return printer.println(printer.warn('Usage: config use <profile_name>'));
    }
    try {
      setCurrentProfile(targetProfile);
      const creds = resolveCredentials({ profileName: targetProfile });
      if (creds) {
        applyCredentials(creds);
        ctx.updateAccountPrompt?.(creds.cloud_name);
        printer.println(printer.ok(`Switched active profile to: ${targetProfile} [cloud: ${creds.cloud_name}]`));
      } else {
        printer.println(printer.warn(`Profile "${targetProfile}" found but has incomplete credentials.`));
      }
    } catch (e) {
      printer.println(printer.error(e?.message || String(e)));
    }
    return;
  }

  // 3. config rm <profile>
  if (subCmd === 'rm' || subCmd === 'delete') {
    const targetProfile = args[1];
    if (!targetProfile) {
      return printer.println(printer.warn('Usage: config rm <profile_name>'));
    }
    const removed = removeProfile(targetProfile);
    if (removed) {
      printer.println(printer.ok(`Removed profile: ${targetProfile}`));
    } else {
      printer.println(printer.warn(`Profile "${targetProfile}" not found.`));
    }
    return;
  }

  // 4. Default: Display active configuration
  const active = getActiveConfig();
  if (!active) {
    printer.println(printer.warn('No active Cloudinary account configured. Run "login" to connect.'));
    return;
  }

  printer.println(chalk.bold('\nActive Cloudinary Configuration:'));
  printer.println('  ' + chalk.cyan('Source:        ') + active.source);
  printer.println('  ' + chalk.cyan('Profile:       ') + active.profile);
  printer.println('  ' + chalk.cyan('Cloud Name:    ') + active.cloud_name);
  printer.println('  ' + chalk.cyan('API Key:       ') + active.api_key);
  printer.println('  ' + chalk.cyan('API Secret:    ') + maskSecret(active.api_secret));
  printer.println('  ' + chalk.cyan('Config File:   ') + chalk.dim(getCredentialsPath()));
  printer.println('');
}
