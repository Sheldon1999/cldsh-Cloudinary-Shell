# Cloudinary Shell (`cldsh`)

[![npm version](https://img.shields.io/npm/v/cloudinary-shell.svg)](https://www.npmjs.com/package/cloudinary-shell)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A tiny interactive CLI (REPL) to explore and manage your Cloudinary account — folder-style.  
Supports **ls**, **cd**, **mkdir**, **upload**, **download**, **mv**, **view**, **open**, **info**, **rm**, **rm -rf**, **pwd**, **lcd**, **lpwd**, **tree**, **url**, and **config**.  
Works fine on the **Free plan**.

> 🤖 **Working on a project that needs Cloudinary?** Pass [**`CLOUDINARY_GUIDE.md`**](CLOUDINARY_GUIDE.md) to your AI agent / LLM for complete integration patterns (Node.js, Next.js, React, Python), URL transformation rules, security standards, and `cldsh` CLI workflows.

## Features
- Familiar shell-like prompt that shows the **current Cloudinary folder**.
- **Tab Autocompletion** for commands, folders, and flags.
- **Persistent Command History** across sessions (Up / Down arrows).
- `ls -l` shows **Size (KB)**, **Dimensions (px)**, **Name**, **Type** with a header.
- `ls [path]` browse contents of arbitrary subfolders or parent folders.
- `info` inspect comprehensive asset metadata (dimensions, size, tags, timestamps).
- `download` save any Cloudinary asset to local disk.
- `upload` from local files or directories, with `-r` (recursive upload with concurrency and collision handling).
- `mv` rename assets or move them across folders (`mv hero archive/hero`).
- `lcd` & `lpwd` navigate your local machine directory directly inside the shell.
- `view` / `preview` render images and video thumbnails **directly inside your terminal** (Warp, iTerm2, WezTerm, VS Code).
- `open` view asset URL in your default browser.
- `tree` draws a **nice ASCII tree** with proper indentation.
- `url` prints the CDN URL; optionally injects a transform string or signs private URLs.
- `rm` and `rm -rf` delete assets or folders (supports **wildcards** like `rm cld*` or `rm *.png`).
- `--dry-run` flag to preview batch uploads and deletions safely.
- Supports `--rt` to browse **image/video/raw** assets.
---

## Quick Start (No Install)

```bash
npx cloudinary-shell
```

Or install globally:

```bash
npm i -g cloudinary-shell
cldsh
```

---

## Prereqs
- **Node.js 18+**
- A Cloudinary account (get `cloud_name`, `api_key`, `api_secret` or `CLOUDINARY_URL`)

---

## Authentication & Credentials

`cldsh` supports multiple secure authentication methods with the following precedence:

$$\text{Active Profile} \;\to\; \text{Environment Variables} \;\to\; \text{Local } .env \;\to\; \text{Global Config Store}$$

### 1. Interactive Login (Recommended)
Run `login` inside the shell (or pass your `CLOUDINARY_URL`):
```bash
$~ login

# Or pass URL directly
$~ login default "cloudinary://<api_key>:<api_secret>@<cloud_name>"
```
Credentials are tested via ping and persisted securely to `~/.config/cldsh/credentials.json` with strict POSIX mode `0600` (owner read/write only).

### 2. Multi-Profile Switching
Manage multiple accounts (e.g. dev, staging, prod):
```bash
$~ login staging "cloudinary://<key>:<secret>@<staging_cloud>"
$~ login prod "cloudinary://<key>:<secret>@<prod_cloud>"

$~ config ls
  Saved Profiles:
  * default (cloud: dev-assets)
    staging (cloud: staging-assets)
    prod (cloud: prod-assets)

$~ config use prod
Switched active profile to: prod [cloud: prod-assets]
[prod-assets]$~
```

### 3. Environment Variable or Local `.env`
Alternatively, set `CLOUDINARY_URL` in your shell or a local `.env`:
```bash
export CLOUDINARY_URL="cloudinary://<key>:<secret>@<cloud_name>"
```
---

## Usage

When launched, you'll see:
```
Cloudinary Shell — type "help" for commands.
$~
```

Prompt shows current folder:

* Root: `$~ `
* Inside a folder: `$~/apps/my-app `

---

## Commands

### help

Show all commands & flags.

```
$~ help
Commands:
  help                                  Show this help
  login [profile]                       Connect Cloudinary credentials (URL or keys)
  config [ls|use <name>|rm <name>]      View or switch active credentials profile
  ls [path|pattern] [-l] [--rt=image]   List folders/files (supports wildcards: cld*, *.png)
  cd [folder|..|/|~|-]                  Change Cloudinary folder (.. up, / or ~ root, - previous)
  pwd                                   Show current Cloudinary folder path
  lcd [local_path]                      Change local directory on machine (defaults to ~)
  lpwd                                  Show current local directory on machine
  mkdir <name>                          Create a subfolder in Cloudinary
  upload <path|dir> [name] [-r] [-o] [--rt=image] [--dry-run] [-v]
                                        Upload file or directory (-r recursive with concurrency)
  download <name|pattern> [dest] [--rt=image]
                                        Download asset(s) matching name or wildcard to local disk
  mv <source> <target> [-o] [--dry-run]
                                        Move or rename asset / move across folders
  info <name|public_id> [--rt=image] [-v]
                                        Inspect asset metadata (dimensions, size, tags)
  open <name|public_id> [--rt=image] [--t="..."]
                                        Open asset URL in default web browser
  view <name|public_id> [--rt=image] [--t="..."]
                                        Display image directly inside terminal (alias: preview)
  url <name|pattern> [--rt=image] [--t="..."] [--signed] [--type=...]
                                        Print CDN URL(s) for name or wildcard pattern
  rm <name|pattern> [--rt=image] [--dry-run]
                                        Remove asset(s) matching name or wildcard (e.g. rm cld*)
  rm -rf <folder|pattern> [--dry-run]   Remove folder(s) and all contents (supports wildcards)
  tree [-d N] [--rt=image]              Show folder tree (depth N)
  exit | quit                           Exit the shell
```

---

### login

Connect and authenticate your Cloudinary account:

```bash
# Interactive guided prompt
$~ login

# Pass URL directly on command line
$~ login "cloudinary://<api_key>:<api_secret>@<cloud_name>"

# Save under a named profile (e.g. staging or prod)
$~ login prod "cloudinary://<api_key>:<api_secret>@<prod_cloud>"
```

---

### config

Inspect active account details or switch between profiles:

```bash
# View active account details and masked secret
$~ config

# List all saved profiles
$~ config ls

# Switch active profile
$~ config use prod

# Delete a saved profile
$~ config rm staging
```
---

### ls

List folders/files in the current Cloudinary folder.

**Short**

```
$~ ls
[DIR] apps
      hero
      logo
```

**Long (with header)** — values are from the **original asset**:

```
$~ ls -l

      SIZE(KB)  DIMENSIONS(px)  NAME           TYPE
      ────────  ──────────────  ─────────────  ────
           245  1200x630        hero           png
            15  512x512         logo           svg
```

Other resource types:

```
$~ ls -l --rt=video
$~ ls -l --rt=raw
```

---

### cd

Change folder (like a shell).

```
$~ ls
[DIR] apps
$~ cd apps
$~/apps ls
[DIR] my-app
$~/apps cd my-app
$~/apps/my-app pwd
/apps/my-app
$~/apps/my-app cd ..
$~/apps cd /
$~ cd -
$~/apps
```

---

### mkdir

Create a subfolder:

```
$~/apps mkdir my-app
Created folder: apps/my-app
```

---

### upload

Upload a local file to the **current** Cloudinary folder.

**Usage**

```
upload <local_path_or_dir> [name] [-r] [-o] [--rt=image] [--dry-run] [-v]
```

* `<local_path_or_dir>`: local file or folder path (`~` supported).
* `[name]`: optional custom public_id for single file upload.
* `-r, --recursive`: recursively upload all nested subdirectories and files, mirroring directory structure into Cloudinary.
* `-o`: overwrite existing assets (default: true).
* `--dry-run`: preview which files will be uploaded and their target public IDs without making API calls.
* `--concurrency=N`: number of simultaneous uploads (default: 4, range 1–10).
* **Collision handling**: files with the same name but different extensions (e.g. `profile.jpg` and `profile.png`) are automatically disambiguated (e.g. `profile_jpg` and `profile_png`) so they never silently overwrite each other.

**Examples**

```
$~/assets upload "~/Pictures/Product Shot.png" product-shot
Uploaded: https://res.cloudinary.com/<cloud>/image/upload/v.../assets/product-shot.png

$~/assets upload ~/Downloads/logo.svg
Uploaded: https://res.cloudinary.com/<cloud>/image/upload/v.../assets/logo.svg
```

Common error:

```
$~ upload ./missing.png
File not found: /absolute/path/to/missing.png
```

---

### rm / rm -rf

Delete a single asset or a folder recursively.

Single asset:

```
# Single asset
$~/assets rm product-shot
Remove: assets/product-shot → ok

# Wildcard asset deletion (e.g. all assets starting with cld)
$~/assets rm cld*
Remove: assets/cld-hero → ok
Remove: assets/cld-banner → ok
Deleted 2 asset(s) matching "cld*".

# Wildcard extension deletion
$~/assets rm *.png
```

Recursive delete:

```
$~/apps rm -rf my-app
Removed folder: apps/my-app

# Wildcard recursive delete
$~/apps rm -rf test*
```
---

### pwd

Print the current folder path:

```
$~/apps/my-app pwd
/apps/my-app
```
---

### mv

Move or rename assets within the current folder or across virtual folders:

```
# Rename an asset in the current folder
$~/assets mv old-logo new-logo

# Move an asset into another folder (retaining basename)
$~/assets mv hero archive/

# Move to an explicit destination path
$~ mv assets/hero archive/2026/hero-legacy

# Preview rename without executing
$~/assets mv hero archive/ --dry-run
```

---

### lcd / lpwd

Manage your local machine working directory without leaving the shell:

```
# Print current local working directory
$~ lpwd
/Users/username/Projects/my-app

# Change local working directory
$~ lcd ~/Pictures
Local directory: /Users/username/Pictures

# Now relative uploads resolve against the new local folder
$~ upload ./screenshot.png
```

---

### tree

Draw an ASCII tree with connectors:

```
$~/MyProject tree -d 3
MyProject
└── pages
    └── home
        ├── carousel
        │   ├── ImageA
        │   ├── ImageB
        │   └── ...
        └── explore-more
            ├── Card1
            └── ...
```

Options:

* `-d N` limit depth (default: infinite)
* `--rt=image|video|raw` resource type
* `--max=100` files per dir (default 100)

---

### url

Print the asset’s CDN URL by name or full public_id. You can inject a transform via `--t`, which is inserted after `/upload/`.

```
# in current folder
$~/assets url product-shot
https://res.cloudinary.com/<cloud>/image/upload/v.../assets/product-shot.png

# with transform
$~/assets url product-shot --t="f_auto,q_auto,w_800"
https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto,w_800/v.../assets/product-shot.png

# use a full public_id from anywhere
$~ url assets/product-shot --t="c_fill,w_600,h_400"
```

---

### info

Inspect complete asset metadata in an aligned card view:

```
$~/assets info logo

  assets/logo
  Resource Type:   image
  Delivery Type:   upload
  Format:          svg
  Dimensions:      512 × 512 px
  File Size:       15 KB
  Created At:      2024-01-15T10:20:30Z
  Version:         v1705314030
  URL:             https://res.cloudinary.com/<cloud>/image/upload/...
```

Add `-v` to print the full raw API response JSON.

---

### download

Download an asset from Cloudinary to your local machine:

```
# downloads to ./logo.svg in current local directory
$~/assets download logo

# download to a custom local destination folder or file path
$~/assets download logo ~/Downloads/
$~/assets download logo ./public/brand-logo.svg
```

---

### open

Open an asset directly in your default browser:

```
$~/assets open logo
$~/assets open logo --t="w_1200,f_auto"
```
---

### view / preview

Render actual high-resolution images and video thumbnails directly inside your terminal emulator (supports Warp, iTerm2, WezTerm, Ghostty, and VS Code terminal):

```
# Display image directly in terminal
$~/portfolio view hero

# Preview a transformation directly in terminal
$~/portfolio view hero --t="w_400,e_grayscale"

# Preview video first-frame poster thumbnail
$~/videos view promo --rt=video
```
---

## Tips

* Prefer `f_auto,q_auto` in `--t` for automatic format/quality:

  ```
  url product-shot --t="f_auto,q_auto,w_1200"
  ```
* Treat folders as namespaces:

  ```
  apps/<app>/<env>/<type>    e.g., apps/my-app/dev/images
  ```
* Keep stable names (public_id) if you plan to replace assets later (re-upload with `-o`).

---

## Troubleshooting

**Missing CLOUDINARY_* env**
Ensure `.env` is present and filled correctly.

**File not found on upload**
Use an absolute path or quote a relative path with spaces. `~` is supported.

**`[object Object]` after upload**
Use the upload command that prints a plain string URL (add `-v` to see the raw response).

**Rate limits on listing**
Admin API calls (`ls`, `tree`, etc.) can be rate-limited on Free. CDN delivery is not.

**Tree looks flat**
Ensure you have the updated `printTree` implementation so connectors/indentation render correctly.

---

## FAQ

**Are `ls -l` dimensions pixels?**
Yes. For images/videos they’re **pixels** of the original asset. For raw files, `?x?`. For SVGs, pixels if detected.

**Are `url` links public?**
Yes for default uploads (`type=upload`). Anyone with the link can access.

**How do I use private images?**
Upload as `type=authenticated` and generate **signed URLs** on your server (never expose your API secret).
Common flow: frontend calls `/media/url?publicId=...`, backend returns `cloudinary.url(..., { sign_url: true, type: 'authenticated' })`.
Or proxy/stream via your backend.

**Time-limited downloads?**
For original file downloads with expiry, use `private_download_url` (requires `type=private` assets) on your server.

---

Happy shipping!
