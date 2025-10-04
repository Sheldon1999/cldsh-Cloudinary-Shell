import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { v2 as cloudinary } from 'cloudinary';

export function loadEnvAndConfig() {
  // lightweight .env loader (no extra deps)
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }

  const required = ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing ${k}. Create .env or pass env vars.`);
      process.exit(1);
    }
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}
