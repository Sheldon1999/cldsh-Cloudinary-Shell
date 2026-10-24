# Cloudinary Shell (`cldsh`) — AI & Developer Reference Guide

> **Purpose:** Reference document for AI coding agents (LLMs) and developers to inspect, upload, transform, and manage Cloudinary media assets using `cldsh`.

---

## 1. Overview & Core Model

`cldsh` provides a virtual filesystem over your Cloudinary account. Instead of writing ad-hoc API scripts, run commands inside the shell or invoke it from terminal.

- **Prompt indicator:** `[cloud_name]$~/current/folder `
- **Root directory:** Represented as `""` or `$` (e.g. `$~ `)
- **Namespacing convention:** Folders represent namespaces (e.g. `portfolio/screenshots`, `apps/my-app/hero`)

---

## 2. Authentication & Environment

`cldsh` automatically loads credentials in the following precedence order:
1. System environment variable: `CLOUDINARY_URL="cloudinary://<api_key>:<api_secret>@<cloud_name>"`
2. Local project `.env` file containing `CLOUDINARY_URL`
3. Global secure profile store: `~/.config/cldsh/credentials.json` (mode `0600`)

### Quick Setup for Projects
Create a `.env` file in the project root:
```ini
CLOUDINARY_URL=cloudinary://<API_KEY>:<API_SECRET>@<CLOUD_NAME>
```

---

## 3. Command Reference
### `login` & `config` — Authentication & Profile Management
```bash
# Interactive login or direct URL connection
$~ login "cloudinary://<api_key>:<api_secret>@<cloud_name>"

# Connect a named profile (e.g. dev, staging, prod)
$~ login prod "cloudinary://<api_key>:<api_secret>@<prod_cloud>"

# View active account details (masked secrets)
$~ config

# List profiles and switch environments
$~ config ls
$~ config use prod
```

---

### `upload` — Upload Local Files or Directories
Uploads local images, videos, or raw documents into the current Cloudinary folder.

```bash
# Upload single file (public_id defaults to filename without extension)
$~/portfolio upload ./screenshot.png

# Upload single file with custom public_id
$~/portfolio upload ./screenshot.png homepage-hero

# Upload entire directory (batch upload)
$~/portfolio upload ./screenshots/

# Recursively upload directory mirroring all nested subfolders (-r)
$~/portfolio upload ./screenshots/ -r

# Dry-run preview without executing
$~/portfolio upload ./screenshots/ -r --dry-run

# Overwrite existing asset (-o flag, default: true)
$~/portfolio upload ./screenshot.png -o

# Upload video or raw document (--rt flag)
$~/videos upload ./demo.mp4 --rt=video
$~/docs upload ./whitepaper.pdf --rt=raw
```

### `url` — Get Optimized CDN Delivery URLs
Retrieves the public CDN delivery URL for any asset, with optional on-the-fly transformations.

```bash
# Get standard delivery URL
$~/portfolio url homepage-hero

# Generate URL with automatic format and compression (Best Practice)
$~/portfolio url homepage-hero --t="f_auto,q_auto"

# Responsive resized URL
$~/portfolio url homepage-hero --t="f_auto,q_auto,w_1200,c_limit"

# Square thumbnail crop
$~/portfolio url avatar --t="c_fill,g_auto,w_300,h_300,f_auto,q_auto"

# Access asset from another folder using full path
$~ url portfolio/homepage-hero --t="f_auto,q_auto"
```

### `ls` — List Folders and Assets
Lists immediate subfolders and assets under current or target folder.

```bash
# Short list
$~/portfolio ls

# Detailed list (Size in KB, Dimensions in px, Format, Name)
$~/portfolio ls -l

# List a specific subfolder without changing cwd
$~ ls portfolio/screenshots -l

# List videos or raw files
$~/portfolio ls -l --rt=video
$~/portfolio ls -l --rt=raw
```

### `info` — Inspect Complete Asset Metadata
Prints technical attributes: dimensions, format, file size, upload timestamp, and delivery tags.

```bash
$~/portfolio info homepage-hero

# Print raw API JSON response
$~/portfolio info homepage-hero -v
```

### `download` — Download Asset to Local Disk
Pulls any remote asset from Cloudinary to a local file or folder.

```bash
# Download to current directory (saved as ./homepage-hero.png)
$~/portfolio download homepage-hero

# Download to custom local directory or filename
$~/portfolio download homepage-hero ./public/images/
$~/portfolio download homepage-hero ./public/hero.png
```

### `open` — Preview in Browser
Launches the asset or transformed CDN URL directly in your default browser.

```bash
$~/portfolio open homepage-hero
$~/portfolio open homepage-hero --t="w_1200,f_auto,q_auto"
```

### `view` / `preview` — Display Image Directly in Terminal
Renders the actual image or video thumbnail directly inside terminal emulators supporting inline graphics (Warp, iTerm2, WezTerm, VS Code terminal).

```bash
# Display image directly in terminal
$~/portfolio view homepage-hero

# Preview a transformation in terminal
$~/portfolio view homepage-hero --t="w_300,e_grayscale"

# Video first-frame thumbnail preview
$~/videos view demo-reel --rt=video
```

### `cd`, `pwd`, `lcd`, `lpwd` — Navigation (Remote & Local)
Navigate both remote Cloudinary folders and local machine paths.

```bash
# Cloudinary virtual folder navigation:
cd <folder>     # Enter Cloudinary subfolder
cd ..           # Move up one level
cd / or cd ~    # Jump to Cloudinary root
cd -            # Toggle to previous Cloudinary folder
pwd             # Print full Cloudinary folder path

# Local machine directory navigation:
lpwd            # Print local working directory on machine
lcd <path>      # Change local working directory (e.g. lcd ~/Pictures)
```

### `mkdir` — Create Folders
```bash
$~/portfolio mkdir screenshots
# Creates: portfolio/screenshots
```

### `rm` — Delete Assets & Folders (Supports Wildcards)
```bash
# Delete a single asset
$~/portfolio rm homepage-hero

# Delete all assets starting with a prefix (Wildcard regex)
$~/portfolio rm cld*

# Delete all PNG files in folder
$~/portfolio rm *.png

# Delete a non-image asset
$~/videos rm demo --rt=video

# Preview deletion without deleting (--dry-run)
$~/portfolio rm cld* --dry-run
$~ rm -rf portfolio/old-archive --dry-run

# Recursively delete a folder and all nested assets (PURGE)
$~ rm -rf portfolio/old-archive

# Recursively delete all folders matching pattern
$~ rm -rf test*
```
---

### `mv` — Move & Rename Assets
Rename assets or move them between virtual folders in Cloudinary.

```bash
# Rename an asset
$~/portfolio mv old-logo new-logo

# Move an asset into a subfolder (keeps basename)
$~/portfolio mv hero archive/

# Move to an explicit destination path
$~ mv portfolio/hero archive/2026/hero

# Preview rename without executing
$~/portfolio mv hero archive/ --dry-run
```

### `tree` — Visualize Folder Hierarchy
Draws ASCII tree connector diagram.

```bash
$~ tree -d 2
# Options:
#   -d N     limit depth to N levels
#   --rt     resource type: image | video | raw
```

---

## 4. Cloudinary Transformation Cheatsheet

When requesting URLs with `--t="..."`, chain transformations with commas:

| Use Case | Transformation String (`--t="..."`) |
| :--- | :--- |
| **Production Web Standard** | `f_auto,q_auto` (serves modern AVIF/WebP, auto-compresses) |
| **Max Width / Responsive** | `f_auto,q_auto,w_1200,c_limit` (scales down only if larger) |
| **Square Avatar / Thumbnail** | `c_fill,g_face,w_200,h_200,f_auto,q_auto` (centers on human face) |
| **Content-Aware Crop** | `c_fill,g_auto,w_800,h_500,f_auto,q_auto` (AI focal point crop) |
| **Grayscale / B&W Effect** | `e_grayscale,f_auto,q_auto` |
| **Rounded Corners** | `r_20,f_auto,q_auto` or `r_max` (circular avatar) |

---

## 5. Scripting Pattern for AI Coding Agents

When an LLM needs to upload assets and inject the resulting URLs into project code (e.g. HTML, React, Markdown, Next.js):

1. **Verify `.env` has `CLOUDINARY_URL`**:
   ```bash
   grep CLOUDINARY_URL .env
   ```
2. **Execute upload using one-line login or direct shell**:
   ```bash
   node cldsh.js
   ```
   Or inside the project, the generated CDN URL follows the canonical pattern:
   `https://res.cloudinary.com/<cloud_name>/image/upload/<transforms>/<folder>/<public_id>.<format>`
3. **Use the returned URL** in image tags:
   ```html
   <img src="https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto/portfolio/hero.png" alt="Hero" />
   ```

---

## 6. Native Model Context Protocol (MCP) Integration

`cloudinary-shell` (`cldsh`) can run directly as a native stdio MCP server for Claude Desktop, Cursor, and any MCP-compliant AI tool.

### Configuration

#### Claude Desktop (`claude_desktop_config.json`)
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

#### Claude Code (Terminal CLI Agent)
```bash
claude mcp add cloudinary npx -y cloudinary-shell --mcp
```

#### Cursor IDE (Cursor Settings -> Features -> MCP Servers)
- **Command**: `npx -y cloudinary-shell --mcp`

#### Diagnostic Self-Test Command
```bash
cldsh mcp
```
### Native Tools Provided

| Tool Name | Description | Key Arguments |
| :--- | :--- | :--- |
| **`cloudinary_list`** | Browse folders and assets with filtering | `path`, `resource_type`, `max` |
| **`cloudinary_upload`** | Upload local file or directory | `local_path`, `name`, `folder`, `recursive`, `overwrite`, `dry_run` |
| **`cloudinary_get_url`** | Generate optimized delivery URLs | `public_id`, `transformation`, `signed`, `resource_type` |
| **`cloudinary_info`** | Inspect asset technical metadata | `public_id`, `resource_type` |
| **`cloudinary_delete`** | Delete asset or recursive folder purge | `target`, `recursive`, `resource_type`, `dry_run` |
| **`cloudinary_move`** | Rename or move assets between folders | `source`, `target`, `overwrite`, `dry_run` |
| **`cloudinary_tree`** | Structural folder tree hierarchy | `folder`, `depth`, `resource_type` |
| **`cloudinary_download`** | Download remote assets to local disk | `public_id`, `destination`, `resource_type` |
