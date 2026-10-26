// Loaded by `npm test` (node --import) into every test process: point HOME at a fresh temp dir so
// no test can read or write the developer's real ~/.config/cldsh (credentials, caches) or history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cldsh-test-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.APPDATA = path.join(home, 'AppData');
delete process.env.CLOUDINARY_URL;
delete process.env.CLOUDINARY_PROFILE;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
delete process.env.CLDSH_FOLDER_MODE;
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
