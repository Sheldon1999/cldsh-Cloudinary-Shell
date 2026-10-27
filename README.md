# Cloudinary Shell (`cldsh`)

### MCP server, interactive shell and scriptable CLI for Cloudinary

[![npm version](https://img.shields.io/npm/v/cloudinary-shell.svg)](https://www.npmjs.com/package/cloudinary-shell)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP Protocol](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)

![cldsh demo: tab completion, a colored `ls -l` listing, a transformed delivery URL, and a recursive delete that previews the plan and asks before anything is removed](docs/demo.gif)

`cldsh` lets you work with a Cloudinary account like a file system:

- **AI agents** (Claude Desktop, Claude Code, Cursor) get Cloudinary tools through the Model Context Protocol (MCP), with previews and confirmation before anything is deleted or replaced.
- **Developers** get an interactive shell with folders, tab completion, history and inline image previews.
- **Scripts and CI** get single commands with JSON output and meaningful exit codes.

It works with both Cloudinary folder modes: **dynamic folders** (every account created since June 2024) and the older **fixed folders**. The mode is detected automatically.

> Working on a project that uses Cloudinary? Give [`INTEGRATION.md`](INTEGRATION.md) to your AI agent or team: integration patterns (Next.js, React, Node.js, Python), transformation recipes and `cldsh` workflows.

---

## How `cldsh` compares

Cloudinary also publishes an official CLI ([`cloudinary-cli`](https://github.com/cloudinary/cloudinary-cli), Python) and official MCP packages ([`@cloudinary/*`](https://github.com/cloudinary/mcp-servers)). `cldsh` is a separate, independent project built for a different workflow: one Node binary that is a shell, a scriptable CLI and an MCP server together, authenticated with your existing API key — no Python runtime, no OAuth browser flow, no hosted service required.

| | `cldsh` | `cloudinary-cli` (official) | `@cloudinary/*` MCP (official) | community MCP servers |
| :--- | :--- | :--- | :--- | :--- |
| Runtime | Node, `npx` | Python, `pipx`/Docker | Node, `npx` per package | Node, `npx` |
| Auth | API key / `.env` | OAuth login | OAuth (hosted) or API key | API key |
| Interactive shell (`cd`, `ls`, tab completion) | ✅ | ❌ one-shot flags | ❌ not a CLI | ❌ not a CLI |
| MCP server | ✅ same binary | ❌ | ✅ (5 separate packages) | ✅ |
| Confirm before delete/move/overwrite | ✅ two-step token, `--dry-run` | ❌ | — | ❌ |
| Fixed/dynamic folder mode | ✅ auto-detected | not documented | not documented | not documented |

Pick `cldsh` for one local tool, API-key auth and a safety net on AI-driven changes. Pick the official packages for Cloudinary-maintained, domain-split MCP servers with OAuth and enterprise support.

---

## Quick start

Requires **Node.js 20 or newer** and a Cloudinary account (cloud name, API key and API secret, or a `CLOUDINARY_URL`).

```bash
# AI agents: add the MCP server to Claude Code
claude mcp add cloudinary npx -y cloudinary-shell --mcp

# Developers: open the interactive shell
npx cloudinary-shell

# Scripts: run one command
npx cloudinary-shell ls products --json
```

Install globally to get the shorter `cldsh` command: `npm install -g cloudinary-shell`.

---

## MCP server (for AI agents)

`cldsh --mcp` runs an MCP server over stdio (JSON-RPC 2.0). It supports protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`.

### Client setup

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cloudinary": {
      "command": "npx",
      "args": ["-y", "cloudinary-shell", "--mcp"]
    }
  }
}
```

**Claude Code**: `claude mcp add cloudinary npx -y cloudinary-shell --mcp`

**Cursor**: Settings → MCP → Add new MCP server, type `command`, command `npx -y cloudinary-shell --mcp`.

Check the setup with `cldsh mcp`: it runs the handshake, lists the tools and makes a live call on your account.

### Tools

| Tool | What it does | Main arguments |
| :--- | :--- | :--- |
| `cloudinary_list` | List folders and assets (wildcards allowed) | `path`, `resource_type`, `delivery_type`, `max` |
| `cloudinary_tree` | Folder tree | `folder`, `depth`, `resource_type`, `max_files` |
| `cloudinary_info` | Full metadata of one asset | `public_id`, `resource_type`, `delivery_type` |
| `cloudinary_get_url` | Delivery URL, optionally transformed or signed | `public_id`, `transformation`, `signed`, `resource_type` |
| `cloudinary_upload` | Upload a local file or directory | `local_path`, `name`, `folder`, `recursive`, `overwrite`, `resource_type`, `dry_run` |
| `cloudinary_download` | Download assets to the local disk | `public_id`, `destination`, `overwrite`, `dry_run` |
| `cloudinary_move` | Move or rename an asset or folder | `source`, `target`, `overwrite`, `change_public_id`, `dry_run` |
| `cloudinary_delete` | Delete assets, or folders with `recursive` | `target`, `recursive`, `resource_type`, `dry_run` |
| `cloudinary_mkdir` | Create a folder | `folder` |
| `cloudinary_rename_folder` | Rename or move a folder (dynamic folder mode) | `from`, `to` |
| `cloudinary_account` | Cloud name, folder mode, credential source, remaining API budget | — |

Every tool carries MCP annotations (read-only, destructive, idempotent), so clients can decide when to ask you.

### Safety

- **Two-step changes.** `cloudinary_delete`, `cloudinary_move`, `cloudinary_rename_folder`, and uploads that would replace existing assets first return a preview with a `confirm_token`. Nothing changes until the agent calls again with the same arguments and that token. Tokens are single-use, expire after 5 minutes and stop working if the account changes. `dry_run: true` only previews.
- **Local files.** Uploads and downloads can only reach the folder the server was started in, the folders your MCP client shares as roots, and folders added with `--allow-path`. The cldsh credentials folder, `~/.ssh` and hidden files (unless named explicitly) are always refused. Downloads never overwrite a local file unless `overwrite: true`.
- **Server options:**
  - `--read-only`: only the read-only tools (list, tree, info, get_url, account).
  - `--allow-path <dir>`: allow another local folder (repeatable).
  - `--no-confirm`: run changes in one call, as in cldsh 1.x. Use only for trusted automation.

```json
"args": ["-y", "cloudinary-shell", "--mcp", "--read-only"]
```

---

## Command line (for scripts and CI)

Run any command directly: `cldsh <command> [arguments] [options]`.

- Results go to **stdout**; progress, warnings and errors go to **stderr**.
- `--json` prints machine-readable JSON on stdout (errors are printed as JSON on stderr).
- **Exit codes:** `0` success, `1` error, `2` wrong usage, `3` partly failed (for example 2 of 50 uploads failed), `4` needs confirmation (add `--yes`) or was cancelled.
- `--profile <name>` uses a saved profile for one command.

```bash
# Upload a build folder with subfolders
cldsh upload ./dist/assets -r --to site/assets

# CDN URLs of every asset in a folder
cldsh ls portfolio --json | jq -r '.files[].secure_url'

# Assets larger than 100 KB
cldsh ls portfolio --json | jq -r '.files[] | select(.bytes > 100000) | .public_id'

# Preview a delete, then run it without the question
cldsh rm 'old-*' --dry-run
cldsh rm -r archive/2023 --yes
```

> **Quote wildcards.** Your shell expands an unquoted `cld*` into local file names before `cldsh` sees it. Write `cldsh rm 'cld*'`. If every name given to `rm` exists in the local directory, `cldsh` refuses and reminds you.

---

## Interactive shell

Run `cldsh` with no arguments.

```
Connected to Cloudinary account: my-cloud (global credentials profile (default))
[my-cloud]$~ cd products
[my-cloud]$~/products ls -l

      SIZE(KB)  DIMENSIONS(px)  NAME      FORMAT  TYPE
      ────────  ──────────────  ────────  ──────  ─────
           245  1200x630        hero      png     image
            15  512x512         logo      svg     image
          1830  1920x1080       promo     mp4     video
```

- The prompt shows the account (and profile) and the current folder.
- Tab completes commands, options, folder paths (`cd apps/<Tab>`) and asset names.
- History is kept across sessions in `~/.cldsh_history` (private file; lines with credentials are never saved).
- Paths are relative to the current folder; `/` or `~` is the root, `..` goes up, `cd -` goes back.
- `help` lists all commands; `help <command>` lists all options of one command.

---

## Commands

| Command | What it does |
| :--- | :--- |
| `login [profile] [URL] [--stdin]` | Connect an account and save it as a profile (checked with Cloudinary first) |
| `config [ls \| use <profile> \| rm <profile>]` | Show the active account and which sources it overrides; list, switch or remove profiles |
| `ls [path\|pattern] [-l]` | List folders and assets |
| `cd`, `pwd` | Change and show the current Cloudinary folder (shell only) |
| `lcd`, `lpwd` | Change and show the local directory |
| `mkdir <folder>...` | Create folders (parents included) |
| `upload <path> [name] [--to folder] [-r]` | Upload a file or a directory |
| `download <name\|pattern>... [destination] [-f]` | Download assets |
| `mv <source> <target> [-o] [--public-id]` | Move or rename an asset or folder |
| `info <name>` | Asset metadata (`-v` for the full API response) |
| `url <name\|pattern>... [--t=...] [--signed]` | Delivery URLs |
| `view <name>` (alias `preview`) | Show an image or video thumbnail in the terminal |
| `open <name>` | Open an asset in the browser |
| `rm [-r] <name\|folder\|pattern>... [-y]` | Delete assets, or folders with `-r` |
| `tree [folder] [-d N]` | Folder tree |
| `quota` | Remaining Admin API requests this hour and the folder mode |
| `mcp` | Check the MCP server |

Options shared by many commands:

| Option | Meaning |
| :--- | :--- |
| `--rt=image\|video\|raw\|all` | Resource type. Listings show all types by default. |
| `--type=upload\|private\|authenticated` | Delivery type |
| `--dry-run` | Show what would happen without changing anything |
| `-y`, `--yes` | Don't ask for confirmation |
| `--json` | JSON output |

Assets can be named by their name in the current folder, by path (`products/hero`), by public ID, or as `asset_id:<id>`. If a name matches several assets (for example an image and a video called `intro`), `cldsh` lists them; add `--rt` or use the public ID.

### Uploading

```
[my-cloud]$~/products upload ~/Pictures/hero.png
Uploaded (created): https://res.cloudinary.com/my-cloud/image/upload/v1730000000/products/hero.png

[my-cloud]$~ upload ./media -r --to campaigns/fall
[1/3] created https://res.cloudinary.com/my-cloud/image/upload/.../campaigns/fall/banner.png
[2/3] created https://res.cloudinary.com/my-cloud/video/upload/.../campaigns/fall/teaser.mp4
[3/3] created https://res.cloudinary.com/my-cloud/raw/upload/.../campaigns/fall/notes.txt
```

- The resource type comes from the file extension: images (including PDF and SVG) → image, video and audio → video, everything else → raw. `--rt` overrides it.
- Images and videos get a public ID without extension; raw files keep it (`notes.txt`).
- `-r` includes subdirectories as subfolders. Dotfiles are skipped.
- Existing assets are overwritten and reported as `overwritten`; `--no-overwrite` keeps them (`skipped`).
- When two files would get the same public ID (`photo.jpg`, `photo.png`), both get their extension as suffix (`photo_jpg`, `photo_png`).
- Files over 20 MB are uploaded in chunks with progress; temporary failures are retried.
- `--dry-run` shows the planned public IDs and works without credentials.

### Deleting

```
[my-cloud]$~/products rm hero
deleted  products/hero
Deleted 1 · not found 0 · failed 0

[my-cloud]$~ rm -r campaigns/fall
Delete 3 assets (1 image, 1 video, 1 raw, 2.1 MB) and 1 folder in cloud my-cloud:
  ...
Proceed? [y/N]
```

- `rm -r` deletes everything in the folder and its subfolders (all resource and delivery types), then the folder.
- Recursive deletes, wildcard deletes and deletes of more than 20 assets show the plan and ask first. Emptying the whole account asks you to type the cloud name. `-y` skips the question; scripts need `--yes`.
- Every asset is reported as `deleted`, `not found` or `failed`, and the exit code is `3` if anything was not found or failed.
- `--skip-backup` deletes folders that still hold backups of deleted assets.

### Moving and renaming

```
[my-cloud]$~/products mv hero archive/
Moved: /products/hero -> /archive/hero (URL unchanged)
```

- **Dynamic folder mode:** moving and renaming keep the delivery URL (the folder and display name change). `--public-id` also renames the public ID, which changes the URL. Folders can be moved and renamed: `mv products catalog/products`.
- **Fixed folder mode:** the folder is part of the public ID, so moving or renaming changes the URL. Cloudinary can't move folders in this mode.
- An existing target stops the move; `-o` goes ahead. In dynamic mode, `-o` only replaces an asset with the same public ID; an asset that merely has the same name is kept.
- `--dry-run` shows whether the URL will change.

### URLs, previews and downloads

```bash
url hero                          # delivery URL
url hero --t="f_auto,q_auto,w_800" # with a transformation
url 'banner-*'                    # several assets
url private-doc --signed          # signed URL for authenticated assets
view hero --t="e_grayscale"       # inline preview (iTerm2, WezTerm, Ghostty, VS Code, Warp)
download 'shots/*' ./shots/       # several files into a folder
```

- Unsigned URLs without `--t` are exactly the asset's `secure_url`.
- `view` prints the preview URL when the terminal can't show images.
- `download` skips local files that already exist unless `-f`; private and authenticated assets download through signed URLs.

---

## Accounts and credentials

```bash
# Interactive (the secret is not shown while you type)
cldsh login

# From a script, without putting the secret in your shell history
printf %s "$CLOUDINARY_URL" | cldsh login prod --stdin

cldsh config ls          # saved profiles
cldsh config use prod    # switch (also inside the shell)
cldsh config             # active account, where it comes from, what it overrides
```

Profiles are stored in `~/.config/cldsh/credentials.json` (`%APPDATA%\cldsh` on Windows) with owner-only permissions. Writes are atomic, and a damaged file is never overwritten (`login --reset` moves it aside).

When several sources are present, the strongest wins:

1. `--profile <name>`, `config use` / `login` in the current shell, or `CLOUDINARY_PROFILE`
2. `CLOUDINARY_URL` (or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) in the environment
3. A `.env` file in the current directory
4. The saved default profile

`cldsh` warns at startup, and `config` shows, when a source is overridden. `CLOUDINARY_URL` options such as `?upload_prefix=https://api-eu.cloudinary.com` (EU/AP data centers) and private CDN settings are supported.

---

## Folder modes and API limits

- `cldsh` detects the folder mode of your account. Override it with `--folder-mode=fixed|dynamic` or `CLDSH_FOLDER_MODE`.
- Listing folders and assets uses Cloudinary's **Admin API**, which is rate-limited per hour (500 requests on the Free plan). `cldsh` caches listings for a few seconds, warns when less than 10% of the hourly budget is left, and `quota` shows the remaining requests. Uploads and delivery URLs don't count.
- In fixed folder mode, listing a folder also pages through its subfolders' assets, so very large folders cost more requests.

---

## Troubleshooting

| Problem | What to do |
| :--- | :--- |
| `Not connected to a Cloudinary account` | Run `cldsh login`, or set `CLOUDINARY_URL`. `cldsh config` shows what is active. |
| The wrong account is used | `cldsh config` lists the source in use and the ones it overrides. |
| `Refusing to run "rm" on ... names that all exist in the local directory` | Your shell expanded a wildcard; quote it: `cldsh rm 'cld*'`. |
| `needs an interactive terminal` / exit code 4 | The command wants a confirmation; add `--yes` in scripts. |
| `matches 2 assets` | Add `--rt=image` (or video/raw) or use the public ID. |
| Rate limit reached | `cldsh quota` shows when the hourly budget resets. |

---

## License

[MIT](LICENSE). See [CHANGELOG.md](CHANGELOG.md) for changes between versions.
