// The only module that imports the Cloudinary SDK. Everything else goes through
// `cloudinary` exported here, so tests can swap the SDK in one place (see
// test/helpers/fake-cloudinary.js) and credentials are applied consistently.
import { v2 as cloudinary } from 'cloudinary';

export { cloudinary };

// Keys a CLOUDINARY_URL may carry besides cloud name, key and secret
// (query parameters or a private CDN path), e.g. upload_prefix for EU/AP data centers.
export const URL_OPTION_KEYS = ['upload_prefix', 'private_cdn', 'secure_distribution', 'cname', 'api_proxy'];

/**
 * Replace the SDK configuration with exactly these credentials.
 * The SDK keeps one mutable config object (seeded from process.env.CLOUDINARY_URL on first use);
 * clearing it first prevents options from a previous account leaking into the next one.
 */
export function configureSdk(creds) {
  let current;
  try {
    current = cloudinary.config();
  } catch {
    // An invalid CLOUDINARY_URL in the environment makes the SDK's first config() throw.
    current = null;
  }
  if (current) {
    for (const key of Object.keys(current)) delete current[key];
  }
  if (!creds) return;
  const options = {};
  for (const key of URL_OPTION_KEYS) {
    if (creds.options?.[key] !== undefined) options[key] = creds.options[key];
  }
  cloudinary.config({
    ...options,
    cloud_name: creds.cloud_name,
    api_key: creds.api_key,
    api_secret: creds.api_secret,
    secure: true,
    // SDK 2.x appends an `_a=` analytics parameter to generated URLs by default; keep URLs clean.
    analytics: false,
  });
}
