````markdown
# Cloudinary Shell (cldsh)

A tiny interactive CLI (REPL) to explore and manage your Cloudinary account like a filesystem.  
Supports **ls**, **cd**, **mkdir**, **upload**, **rm**, **rm -rf**, **pwd**, **tree**, and **url**.  
Works on the **Free** plan.

---

## Features
- Shell-like prompt that shows the **current Cloudinary folder**.
- `ls -l` prints a table with **SIZE(KB)**, **DIMENSIONS(px)**, **NAME**, **TYPE**.
- `tree` draws a clean ASCII tree with proper connectors.
- `upload` from any local path (supports quotes and `~`) and prints the **CDN URL**.
- `url` fetches the CDN URL later; `--t="f_auto,q_auto,w_800"` injects a transform segment.
- `rm -rf` recursively deletes folders (careful!).
- `--rt=image|video|raw` to browse different resource types.

---

## Prereqs
- **Node.js 18+**
- Cloudinary account (`cloud_name`, `api_key`, `api_secret`)

---

## Setup
```bash
# in the CLI folder
npm i

# environment
cp .env.example .env
# edit .env with your Cloudinary creds
````

Optional (to run `cldsh` globally):

```bash
npm link
# now you can run: cldsh
```

---

## Environment

Create a `.env` next to the CLI:

```ini
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

> `.env.example` is provided; `.env` is gitignored.

---

## Run

```bash
# global (if linked)
cldsh

# or local
node cldsh.js
```

You’ll see:

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
  help                      Show this help
  ls [-l] [--rt=image]      List folders/files in current folder
  cd <folder|..|/|->        Change folder (.. up, / root, - previous)
  mkdir <name>              Create a subfolder
  upload <path> [name] [-o] [--rt=image] [-v]
                            Upload file as [name] (defaults to file basename)
  rm <name|public_id>       Remove a single asset
  rm -rf <folder>           Remove a folder and all contents
  pwd                       Show current folder path
  tree [-d N] [--rt=image]  Show folder tree (depth N)
  url <name|public_id> [--rt=image] [--t="..."]
                            Print CDN URL (optionally with transform)
  exit | quit               Exit the shell
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
upload <local_path> [name] [-o] [--rt=image] [-v]
```

* `<local_path>` can be absolute or relative; quote if it has spaces. `~` is supported.
* `[name]` (optional) is the **public_id** (no extension). Default: local file basename.
* `-o` overwrite (default: true)
* `--rt` one of `image` (default), `video`, or `raw`
* `-v` also print the raw Cloudinary response (debug)

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
$~/assets rm product-shot
Remove: assets/product-shot → ok
```

Recursive delete:

```
$~/apps rm -rf my-app
Removed folder: apps/my-app
```

---

### pwd

Print the current folder path:

```
$~/apps/my-app pwd
/apps/my-app
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
