import { v2 as cloudinary } from 'cloudinary';
import {
  parseCloudinaryUrl,
  saveProfile,
} from '../lib/credentials.js';
import { applyCredentials } from '../lib/env.js';

export default async function loginCmd(ctx, args = [], _flags = {}) {
  const { printer, askUser } = ctx;

  const urlCandidate = args.find(a => parseCloudinaryUrl(a));
  const profileName = args[0] && !parseCloudinaryUrl(args[0]) ? args[0] : 'default';

  let creds = null;

  if (urlCandidate) {
    creds = parseCloudinaryUrl(urlCandidate);
  } else {
    printer.println('\n' + printer.strong('Connect Cloudinary Account'));
    printer.println(printer.dim('Paste your CLOUDINARY_URL, or press Enter to input credentials individually.\n'));

    const directInput = await askUser('CLOUDINARY_URL (optional): ');
    if (directInput) {
      creds = parseCloudinaryUrl(directInput);
      if (!creds) {
        return printer.println(printer.error('\nInvalid CLOUDINARY_URL format. Expected:\ncloudinary://<api_key>:<api_secret>@<cloud_name>\n'));
      }
    } else {
      const cloudName = await askUser('Cloud Name: ');
      const apiKey = await askUser('API Key:    ');
      const apiSecret = await askUser('API Secret: ');

      if (!cloudName || !apiKey || !apiSecret) {
        return printer.println(printer.warn('\nLogin cancelled: Cloud Name, API Key, and API Secret are all required.\n'));
      }

      creds = {
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      };
    }
  }

  printer.println(printer.dim('\nValidating credentials with Cloudinary...'));

  // Test ping with these credentials
  try {
    cloudinary.config({
      cloud_name: creds.cloud_name,
      api_key: creds.api_key,
      api_secret: creds.api_secret,
      secure: true,
    });

    const pingRes = await cloudinary.api.ping();
    if (pingRes.status !== 'ok') {
      throw new Error(`Cloudinary returned status: ${pingRes.status}`);
    }

    // Ping succeeded: persist securely to global credentials.json (0600 mode)
    saveProfile(profileName, creds, true);
    applyCredentials({ ...creds, source: `global credentials profile (${profileName})`, profile: profileName });
    ctx.updateAccountPrompt?.(creds.cloud_name);

    printer.println(printer.ok(`\nConnected successfully!`));
    printer.println(`Active Account: ${printer.strong(creds.cloud_name)} (profile: ${profileName})\n`);
  } catch (e) {
    printer.println(printer.error(`\nAuthentication failed: ${e?.message || String(e)}`));
    printer.println(printer.dim('Credentials were not saved. Please verify your credentials and try again.\n'));
  }
}
