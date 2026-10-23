import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { v2 as cloudinary } from 'cloudinary';
import {
  loadCredentialsStore,
  getProfile,
  parseCloudinaryUrl,
} from './credentials.js';

let activeConfig = null;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const res = {};
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (m) {
        const key = m[1];
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        res[key] = val;
      }
    }
  } catch {}
  return res;
}

export function resolveCredentials({ profileName = null } = {}) {
  // 1. Check direct system env vars
  if (process.env.CLOUDINARY_URL) {
    const parsed = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
    if (parsed) {
      return { ...parsed, source: 'environment (CLOUDINARY_URL)', profile: 'env' };
    }
  }

  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    return {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      source: 'environment variables',
      profile: 'env',
    };
  }

  // 2. Check local .env in current directory
  const localEnvPath = path.resolve(process.cwd(), '.env');
  const localEnv = parseEnvFile(localEnvPath);
  if (localEnv.CLOUDINARY_URL) {
    const parsed = parseCloudinaryUrl(localEnv.CLOUDINARY_URL);
    if (parsed) {
      return { ...parsed, source: 'local .env (CLOUDINARY_URL)', profile: 'local' };
    }
  }
  if (localEnv.CLOUDINARY_CLOUD_NAME && localEnv.CLOUDINARY_API_KEY && localEnv.CLOUDINARY_API_SECRET) {
    return {
      cloud_name: localEnv.CLOUDINARY_CLOUD_NAME,
      api_key: localEnv.CLOUDINARY_API_KEY,
      api_secret: localEnv.CLOUDINARY_API_SECRET,
      source: 'local .env',
      profile: 'local',
    };
  }

  // 3. Check global credentials.json store
  const store = loadCredentialsStore();
  const targetProfile = profileName || process.env.CLOUDINARY_PROFILE || store.current_profile || 'default';
  const profileCreds = getProfile(targetProfile, store);
  if (profileCreds && profileCreds.cloud_name && profileCreds.api_key && profileCreds.api_secret) {
    return {
      ...profileCreds,
      source: `global credentials profile (${targetProfile})`,
      profile: targetProfile,
    };
  }

  return null;
}

export function applyCredentials(creds) {
  if (!creds) {
    activeConfig = null;
    return false;
  }
  cloudinary.config({
    cloud_name: creds.cloud_name,
    api_key: creds.api_key,
    api_secret: creds.api_secret,
    secure: true,
  });
  activeConfig = creds;
  return true;
}

export function getActiveConfig() {
  return activeConfig;
}

export function isConfigured() {
  return Boolean(activeConfig && activeConfig.cloud_name && activeConfig.api_key && activeConfig.api_secret);
}

export function loadEnvAndConfig({ profileName = null } = {}) {
  const creds = resolveCredentials({ profileName });
  if (creds) {
    applyCredentials(creds);
    return {
      configured: true,
      source: creds.source,
      cloud_name: creds.cloud_name,
      profile: creds.profile,
    };
  }
  return {
    configured: false,
    source: null,
    cloud_name: null,
    profile: null,
  };
}
