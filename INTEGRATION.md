# Cloudinary Shell (`cldsh`) — Complete Integration & Engineering Guide

> **Audience**: Developers, DevOps engineers, and AI coding agents (Claude, Cursor, Copilot) integrating Cloudinary into applications, CI/CD pipelines, or agentic tool-calling workflows.  
> **Package**: [`cloudinary-shell`](https://www.npmjs.com/package/cloudinary-shell) (CLI command: `cldsh`)

---

## 1. Architecture Overview: The 3 Operating Modes

`cloudinary-shell` (`cldsh`) is a unified tool designed for both humans and machines, operating dynamically across three modes from a single executable:

```
                                  ┌──────────────────────────────┐
                                  │   cldsh / cloudinary-shell   │
                                  │   (Unified Core Engine)      │
                                  └──────────────┬───────────────┘
                                                 │
            ┌────────────────────────────────────┼───────────────────────────────────┐
            ▼                                    ▼                                   ▼
    [ 1. Interactive REPL ]             [ 2. Headless CLI ]                 [ 3. Native MCP Server ]
    cldsh                               cldsh <cmd> [args] [--json]         cldsh --mcp
    (Human Developers)                  (Scripts, CI/CD, & Automation)      (Claude, Cursor, & AI Agents)
    ────────────────────────            ──────────────────────────────      ─────────────────────────────
    • Virtual filesystem shell          • Single-shot execution             • stdio JSON-RPC 2.0 protocol
    • Prompt: [cloud_name]$~/folder     • Exit codes 0/1/2/3/4              • 11 tools with annotations
    • Tab autocompletion                • stdout (data) / stderr (errors)   • Preview + confirm token for changes
    • Inline terminal graphics (view)   • Clean machine-readable JSON       • Local files limited to allowed roots
    • Persistent command history        • Seamless piping to jq / curl      • Strict stdout stream hygiene
```

---

## 2. Authentication & Credential Hierarchy

`cldsh` resolves credentials in this order (strongest first):
1. An explicit profile: `--profile <name>`, `config use` / `login` in the current shell, or `CLOUDINARY_PROFILE`
2. `CLOUDINARY_URL` (or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) in the environment
3. A `.env` file in the current directory
4. The saved default profile in `~/.config/cldsh/credentials.json`

`cldsh config` shows the source in use and every source it overrides.

### 2.1 The Connection String Format
Cloudinary uses a single unified connection URI:
```text
CLOUDINARY_URL=cloudinary://<API_KEY>:<API_SECRET>@<CLOUD_NAME>
```

### 2.2 Global Store with Strict POSIX Permissions
When you log in via `cldsh login`, credentials are saved globally in:
- **macOS / Linux**: `~/.config/cldsh/credentials.json`
- **Windows**: `%APPDATA%\cldsh\credentials.json`

File permissions are enforced at **`0600`** (`rw-------`) and directories at **`0700`** (`rwx------`). Secrets are completely isolated from your Git repositories and cannot be accidentally committed.

### 2.3 Profile Management Commands
```bash
# Connect interactively (the secret is hidden while you type)
$~ login

# From scripts: pass the URL on stdin so it stays out of shell history and the process list
printf %s "$CLOUDINARY_URL" | cldsh login dev --stdin
printf %s "$PROD_CLOUDINARY_URL" | cldsh login prod --stdin

# List all saved profiles (* marks the active one)
$~ config ls

# Switch active profile live
$~ config use prod

# Inspect active account (secrets are safely masked)
$~ config
```

---

## 3. Mode 3: Native Model Context Protocol (MCP) Server

When invoked with `--mcp`, `cloudinary-shell` boots as an stdio JSON-RPC 2.0 server complying with Anthropic's Model Context Protocol.

### 3.1 Why Use MCP for Cloudinary?
Cloudinary's native SDK splits methods across multiple namespaces (`api`, `uploader`, `search`). When LLMs write ad-hoc scripts, they frequently hallucinate parameter names, leak API secrets, and struggle with cursor pagination. Exposing atomic tools over MCP cuts token consumption by 80%+ and delivers deterministic, error-free results.

### 3.2 AI Client Setup

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

#### Cursor IDE
In **Cursor Settings** $\to$ **Features** $\to$ **MCP Servers** $\to$ **Add New MCP Server**:
- **Name**: `cloudinary`
- **Type**: `command`
- **Command**: `npx -y cloudinary-shell --mcp`

#### Built-in MCP Diagnostic Self-Test
Verify that your MCP server handshake, tool declarations, and account connection are healthy:
```bash
cldsh mcp
```

### 3.3 The 11 MCP Tools

| Tool Name | Description | Key Arguments |
| :--- | :--- | :--- |
| **`cloudinary_list`** | Browse folders & assets (wildcards allowed) | `path`, `resource_type` (image/video/raw/all, default all), `delivery_type`, `max` |
| **`cloudinary_tree`** | Folder tree | `folder`, `depth`, `resource_type`, `max_files` |
| **`cloudinary_info`** | Asset metadata (dimensions, bytes, tags) | `public_id` *(req)*, `resource_type`, `delivery_type` |
| **`cloudinary_get_url`** | Delivery URL with optional transformation or signature | `public_id` *(req)*, `transformation`, `signed`, `resource_type` |
| **`cloudinary_upload`** | Upload a local file or directory | `local_path` *(req)*, `name`, `folder`, `recursive`, `overwrite`, `resource_type` (default: by extension), `dry_run`, `confirm_token` |
| **`cloudinary_download`** | Download assets to local disk | `public_id` *(req)*, `destination`, `overwrite`, `dry_run` |
| **`cloudinary_move`** | Move or rename an asset or folder | `source` *(req)*, `target` *(req)*, `overwrite`, `change_public_id`, `dry_run`, `confirm_token` |
| **`cloudinary_delete`** | Delete assets, or folders with `recursive` | `target` *(req)*, `recursive`, `resource_type`, `dry_run`, `confirm_token` |
| **`cloudinary_mkdir`** | Create a folder | `folder` *(req)* |
| **`cloudinary_rename_folder`** | Rename or move a folder (dynamic folder mode) | `from` *(req)*, `to` *(req)*, `confirm_token` |
| **`cloudinary_account`** | Cloud name, folder mode, credential source, remaining Admin API budget | — |

**Two-step changes.** Delete, move, rename_folder and uploads that would replace existing assets first return `needs_confirmation`, a plan and a `confirm_token` (single-use, 5 minutes, tied to the account). Call the same tool again with the same arguments plus `confirm_token` to run exactly that plan. `dry_run: true` only previews.

**Local files.** Upload and download only reach the server's working directory, the client's MCP roots and `--allow-path <dir>` folders; the cldsh config folder, `~/.ssh` and unnamed hidden files are refused. Downloads don't overwrite without `overwrite: true`.

**Server options:** `--read-only` (read-only tools only), `--allow-path <dir>` (repeatable), `--no-confirm` (single-call changes, as in cldsh 1.x).

---

## 4. Mode 2: Headless CLI Mode (Automation, Scripts & CI/CD)

When passed CLI arguments, `cldsh` executes in single-shot mode:
- **`stdout`**: Clean data payload (or JSON).
- **`stderr`**: Diagnostics and errors.
- **Exit codes**: `0` success, `1` error, `2` usage error, `3` partial failure (some items failed), `4` confirmation needed (add `--yes`) or cancelled.
- **Wildcards**: quote them (`cldsh rm 'cld*'`), otherwise your shell expands them into local file names first.

### 4.1 Automated CI/CD Pipelines (GitHub Actions Example)
```yaml
name: Deploy Static Assets
on:
  push:
    branches: [main]

jobs:
  upload-media:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Mirror Assets to Cloudinary
        env:
          CLOUDINARY_URL: ${{ secrets.CLOUDINARY_URL }}
        run: npx cloudinary-shell upload ./public/media -r --to site/media --concurrency=5
```

### 4.2 Shell Scripting & `jq` Recipes
```bash
# 1. Extract only the secure CDN URLs for all assets in a folder:
cldsh ls portfolio --json | jq -r '.files[].secure_url'

# 2. Calculate total storage used by all images in a folder:
cldsh ls portfolio --json | jq '[.files[].bytes] | add'

# 3. Find all images larger than 500 KB:
cldsh ls portfolio --json | jq '.files[] | select(.bytes > 500000) | .public_id'

# 4. Filter by format (e.g. all WebP images):
cldsh ls portfolio --json | jq '.files[] | select(.format == "webp") | .public_id'
```

### 4.3 `package.json` Automation Shortcuts
```json
{
  "scripts": {
    "media:sync": "cloudinary-shell upload ./public/assets -r",
    "media:preview": "cloudinary-shell upload ./public/assets -r --dry-run",
    "media:audit": "cloudinary-shell ls portfolio -l"
  }
}
```

---

## 5. Mode 1: Interactive Virtual Shell (`cldsh`)

Launch `cldsh` with zero arguments to open an interactive terminal REPL.

### Complete Command Reference

| Command | Syntax | Description & Example |
| :--- | :--- | :--- |
| **`ls`** | `ls [path\|pattern] [-l] [--rt=...]` | List contents (all resource types by default). Wildcards: `ls 'cld*'`, `ls '*.png'`. `-l` adds size, dimensions, format, type. |
| **`cd`** | `cd [folder \| .. \| / \| ~ \| -]` | Navigate folders (shell only). Paths are relative to the current folder. |
| **`pwd`** | `pwd` | Print current Cloudinary folder path. |
| **`lcd`** | `lcd [local_path]` | Change local working directory (supports `~`). |
| **`lpwd`** | `lpwd` | Print current local working directory. |
| **`mkdir`** | `mkdir <folder>...` | Create folders (parents included). |
| **`upload`** | `upload <path> [name] [--to folder] [-r] [--no-overwrite] [--dry-run]` | Upload a file or directory; resource type from the extension; raw files keep their extension. |
| **`download`**| `download <name\|pattern>... [dest] [-f]` | Download assets; existing local files are skipped unless `-f`. |
| **`mv`** | `mv <source> <target> [-o] [--public-id] [--dry-run]` | Move or rename assets or folders. Dynamic folder mode keeps URLs unless `--public-id`. |
| **`info`** | `info <name\|public_id\|asset_id:ID> [-v]` | Asset metadata card (`-v`: full API response). |
| **`view`** | `view <name> [--t="..."]` | Image or video thumbnail **inside the terminal** (alias: `preview`). |
| **`open`** | `open <name> [--t="..."]` | Open the asset in the browser. |
| **`url`** | `url <name\|pattern>... [--t="..."] [--signed]` | Delivery URLs, optionally transformed or signed. |
| **`rm`** | `rm [-r] <name\|folder\|pattern>... [--dry-run] [-y]` | Delete assets, or folders with `-r`. Bulk deletes ask first; scripts need `--yes`. |
| **`tree`** | `tree [folder] [-d N]` | Folder tree up to depth `N`. |
| **`quota`** | `quota` | Remaining Admin API requests this hour and the folder mode. |
| **`mcp`** | `mcp` | Self-test of the MCP server. |
| **`login`** | `login [profile] [url] [--stdin]` | Connect and save an account. |
| **`config`**| `config [ls \| use <name> \| rm <name>]` | Show, list, switch or remove profiles. |
| **`exit`** | `exit \| quit` | Exit shell. |

---

## 6. Cloudinary Architecture & Implementation Patterns

### 6.1 Asset Identifiers: `public_id` vs URLs
- **`public_id`**: The unique identifier of an asset in Cloudinary (e.g. `portfolio/hero` or `products/shoe_red`).
- **Critical Rule**: **Don't include the file extension in an image or video `public_id`** (use `hero`, not `hero.png`). Cloudinary serves any format dynamically via URL extensions (e.g. `.../hero.webp`, `.../hero.avif`). **Raw files are the exception**: their `public_id` includes the extension (`docs/terms.txt`, `data/feed.json`).
- **Folders**: In **dynamic folder mode** (all accounts created since June 2024) an asset's folder is its `asset_folder`, independent of its `public_id`; slashes in a `public_id` only shape the URL. In the older **fixed folder mode**, slashes in the `public_id` are the folder path. Check with `cldsh quota` or the Admin API `config?settings=true`.

### 6.2 Resource Types
Cloudinary isolates assets into three distinct pools:
- **`image`** (default): Raster images, vector SVGs, animated GIFs.
- **`video`**: MP4, WebM, MOV, audio files (MP3, WAV).
- **`raw`**: Documents (DOCX, XLSX, TXT), archives (ZIP, TAR), fonts (WOFF2, TTF), JSON. PDFs are usually uploaded as `image`, which enables page previews and transformations.

### 6.3 Dynamic CDN Transformations & The Golden Baseline
Transformations are applied **on the fly** by inserting parameters between `/upload/` and the asset path:
```text
https://res.cloudinary.com/<cloud_name>/<resource_type>/upload/<transformations>/v<version>/<public_id>.<format>
```

#### The Golden Optimization Baseline: `f_auto,q_auto`
Always include `f_auto,q_auto` in delivery URLs:
- **`f_auto`** (Automatic Format): Serves AVIF or WebP to modern browsers, falling back to PNG/JPEG for legacy clients.
- **`q_auto`** (Automatic Quality): Applies perceptual compression that minimizes file size without visible loss.

### 6.4 Common Transformation Recipes

| Use Case | Transformation String | Explanation |
| :--- | :--- | :--- |
| **Production Standard** | `f_auto,q_auto` | Universal modern format + perceptual compression. |
| **Responsive Max Width** | `f_auto,q_auto,w_1200,c_limit` | Scales down to max 1200px; never upscales smaller images. |
| **Smart Content Crop** | `f_auto,q_auto,c_fill,g_auto,w_800,h_500` | Fills 800x500 box using AI focus/saliency detection. |
| **User Avatar (Circle)** | `f_auto,q_auto,c_thumb,g_face,w_200,h_200,r_max` | Centers on human face, crops square, rounds to full circle. |
| **Fixed Width (Fit)** | `f_auto,q_auto,c_fit,w_600` | Fits within 600px maintaining original aspect ratio. |
| **Grayscale Effect** | `e_grayscale,f_auto,q_auto` | Converts to black & white. |

---

## 7. Implementation Code Patterns by Tech Stack

> **Folder parameter.** The samples below use `folder`, which works in both folder modes. In **dynamic folder mode** (all accounts created since June 2024) Cloudinary recommends `asset_folder` for new code: it places the asset in a folder without changing its public ID. Add `public_id_prefix` (or `use_asset_folder_as_public_id_prefix: true`) if the folder path should also appear in the delivery URL. In **fixed folder mode** only `folder` exists.

### 7.1 Next.js (App Router, Server Actions & `<Image />`)

#### Server Action Upload Handler
```typescript
// app/actions/upload.ts
'use server';

import { v2 as cloudinary } from 'cloudinary';
cloudinary.config({ secure: true });

export async function uploadImageAction(formData: FormData) {
  const file = formData.get('file') as File | null;
  if (!file) throw new Error('No file provided');

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'nextapp/uploads', resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    ).end(buffer);
  });
}
```

#### Client Rendering with Next.js Image Component
```tsx
// components/CloudinaryImage.tsx
import Image from 'next/image';

interface CloudinaryImageProps {
  publicId: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}

export function CloudinaryImage({ publicId, alt, width, height, className }: CloudinaryImageProps) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const cleanId = publicId.replace(/^\/+/, '');
  const transform = `f_auto,q_auto,w_${width},h_${height},c_fill`;
  const src = `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${cleanId}`;

  return <Image src={src} alt={alt} width={width} height={height} className={className} loading="lazy" />;
}
```

### 7.2 Node.js / Express (Streaming Buffer Uploads)
Avoid writing temporary files to disk (essential for Docker, Serverless, and AWS Lambda):

```typescript
// lib/cloudinary.ts
import { v2 as cloudinary, type UploadApiResponse, type UploadApiOptions } from 'cloudinary';

cloudinary.config({ secure: true });

export function uploadBufferToCloudinary(buffer: Buffer, options: UploadApiOptions = {}): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: options.resource_type || 'auto', folder: options.folder || 'uploads', ...options },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Upload failed.'));
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}
```

### 7.3 Python (FastAPI / Django)
```python
# lib/cloudinary_service.py
import cloudinary
import cloudinary.uploader
from fastapi import UploadFile

cloudinary.config(secure=True)

def upload_file_stream(file: UploadFile, folder: str = "uploads") -> dict:
    response = cloudinary.uploader.upload(
        file.file,
        folder=folder,
        resource_type="auto",
        overwrite=True
    )
    return {
        "url": response.get("secure_url"),
        "public_id": response.get("public_id"),
        "format": response.get("format"),
        "bytes": response.get("bytes"),
    }
```

---

## 8. Critical Anti-Patterns Checklist (Enforce These Rules)

1. ❌ **NEVER include the file extension in `public_id`**
   - *Wrong*: `cloudinary.uploader.upload(file, { public_id: 'banner.png' })`
   - *Result*: Asset is stored with ID `banner.png`. Rendering `<img src=".../banner.png.png">` or transforms fail.
   - *Right*: `cloudinary.uploader.upload(file, { public_id: 'banner' })`. Exception: **raw** files keep their extension (`public_id: 'docs/terms.txt'` with `resource_type: 'raw'`).

2. ❌ **NEVER leak `api_secret` or `CLOUDINARY_URL` to frontend code**
   - *Wrong*: Putting `CLOUDINARY_URL` in `NEXT_PUBLIC_` or `VITE_` env vars.
   - *Result*: Complete account compromise (anyone can delete or overwrite all assets).
   - *Right*: Client only receives `cloud_name` or calls backend endpoints for signed requests.

3. ❌ **NEVER use `resource_type: "image"` for audio, video, fonts or office documents**
   - *Wrong*: Uploading an MP3 or a DOCX with the default resource type.
   - *Result*: The upload fails ("Invalid image file").
   - *Right*: Pass `resource_type: "video"` for audio/video and `"raw"` for other files, or `"auto"` to let Cloudinary decide. `cldsh upload` picks the type from the extension.

4. ❌ **NEVER call `api.delete_folder(folder)` without deleting assets first**
   - *Wrong*: Expecting Cloudinary Admin API `delete_folder` to delete contents.
   - *Result*: Cloudinary API throws `FolderNotEmpty` error.
   - *Right*: Find the folder's assets first: in dynamic folder mode with `api.resources_by_asset_folder(folder)` (a public ID prefix doesn't tell you the folder), in fixed folder mode with `api.resources({ type: 'upload', prefix: folder + '/' })`; delete them (in pages, `delete_resources` takes up to 100 IDs), then the folder. Or use `cldsh rm -r <folder>`.

5. ❌ **NEVER write files to local disk in Serverless/Container runtimes**
   - *Wrong*: `fs.writeFileSync('/tmp/' + name)` then uploading file path.
   - *Result*: Disk exhaustion, read-only filesystem errors in AWS Lambda, poor performance.
   - *Right*: Use `cloudinary.uploader.upload_stream` with buffers.

6. ❌ **NEVER deliver raw untransformed image URLs**
   - *Wrong*: `https://res.cloudinary.com/demo/image/upload/sample.jpg` (delivers massive 5MB camera original).
   - *Right*: `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1200/sample.jpg` (delivers optimized 80KB WebP/AVIF).
