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
    • Prompt: [cloud_name]$~/folder     • Standard exit codes (0/1)         • 8 atomic function tools
    • Tab autocompletion                • stdout (data) / stderr (errors)   • Zero token hallucination
    • Inline terminal graphics (view)   • Clean machine-readable JSON       • Inherits ~/.config auth
    • Persistent command history        • Seamless piping to jq / curl      • Strict stdout stream hygiene
```

---

## 2. Authentication & Credential Hierarchy

`cldsh` resolves credentials in this strict order:
$$\text{Active Session / CLI Flag} \;\to\; \text{Environment Variables} \;\to\; \text{Local } .env \;\to\; \text{Global Config Store } (\texttt{\textasciitilde/.config/cldsh/credentials.json})$$

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
# Connect interactively or pass URL directly
$~ login "cloudinary://<api_key>:<api_secret>@<cloud_name>"

# Connect multiple accounts / environments (dev, staging, prod)
$~ login dev "cloudinary://<key>:<secret>@<dev-cloud>"
$~ login prod "cloudinary://<key>:<secret>@<prod-cloud>"

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

### 3.3 The 8 Native MCP Tools

| Tool Name | Description | Key Arguments |
| :--- | :--- | :--- |
| **`cloudinary_list`** | Browse folders & media assets | `path` (string), `resource_type` (image/video/raw), `max` (number) |
| **`cloudinary_upload`** | Upload local file or directory (recursive & concurrent) | `local_path` *(req)*, `name`, `folder`, `recursive`, `overwrite`, `dry_run` |
| **`cloudinary_get_url`** | Generate optimized delivery URLs & transformations | `public_id` *(req)*, `transformation`, `signed`, `resource_type` |
| **`cloudinary_info`** | Inspect asset technical metadata (dimensions, bytes, tags) | `public_id` *(req)*, `resource_type` |
| **`cloudinary_delete`** | Delete assets or recursive folder purge | `target` *(req)*, `recursive` (boolean), `resource_type`, `dry_run` |
| **`cloudinary_move`** | Rename or move assets across virtual folders | `source` *(req)*, `target` *(req)*, `overwrite`, `dry_run` |
| **`cloudinary_tree`** | Directory tree hierarchy visualization | `folder` (string), `depth` (number), `resource_type` |
| **`cloudinary_download`** | Download remote assets to local disk | `public_id` *(req)*, `destination` (string), `resource_type` |

---

## 4. Mode 2: Headless CLI Mode (Automation, Scripts & CI/CD)

When passed CLI arguments, `cldsh` executes in single-shot mode:
- **`stdout`**: Clean data payload (or JSON).
- **`stderr`**: Diagnostics and errors.
- **Exit codes**: `0` on success, `1` on error.

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
        run: npx cloudinary-shell upload ./public/media -r --concurrency=5
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
| **`ls`** | `ls [path\|pattern] [-l] [--rt=image]` | List contents. Supports wildcards (`ls cld*`, `ls *.png`). `-l` adds size, dimensions, format. |
| **`cd`** | `cd [folder \| .. \| / \| ~ \| -]` | Navigate virtual folders. `cd /` (root), `cd ..` (up), `cd -` (toggle back). |
| **`pwd`** | `pwd` | Print current Cloudinary folder path. |
| **`lcd`** | `lcd [local_path]` | Change local machine working directory (supports `~`). |
| **`lpwd`** | `lpwd` | Print current local working directory on machine. |
| **`mkdir`** | `mkdir <name>` | Create a subfolder. `mkdir avatars` |
| **`upload`** | `upload <path\|dir> [name] [-r] [-o] [--dry-run]` | Upload file or directory (`-r` mirrors subfolders with concurrency and collision protection). |
| **`download`**| `download <name\|pattern> [dest] [--rt=image]` | Download asset(s) matching name or wildcard to local disk. |
| **`mv`** | `mv <source> <target> [-o] [--dry-run]` | Rename or move assets within or across folders. `mv hero archive/` |
| **`info`** | `info <name\|public_id> [--rt=image] [-v]` | Complete asset metadata card (dimensions, size, format, timestamps, tags). |
| **`view`** | `view <name\|public_id> [--rt=image] [--t="..."]` | Display actual high-resolution image or video thumbnail **directly inside terminal** (alias: `preview`). |
| **`open`** | `open <name\|public_id> [--t="..."]` | Open asset CDN URL in default web browser. |
| **`url`** | `url <name\|pattern> [--t="..."] [--signed]` | Print optimized CDN URL with transformations. |
| **`rm`** | `rm <name\|pattern> [--rt=image] [--dry-run]` | Delete single or matching assets (supports wildcards: `rm cld*`, `rm *.png`). |
| **`rm -rf`** | `rm -rf <folder\|pattern> [--dry-run]` | Recursively delete folders and all nested contents. |
| **`tree`** | `tree [-d N] [--rt=image]` | Render ASCII folder hierarchy tree with connectors up to depth `N`. |
| **`mcp`** | `mcp` | Run live self-test of the MCP server and tool health check. |
| **`login`** | `login [profile] [url]` | Authenticate credentials. |
| **`config`**| `config [ls \| use <name> \| rm <name>]` | Inspect or switch active credentials profile. |
| **`exit`** | `exit \| quit` | Exit shell. |

---

## 6. Cloudinary Architecture & Implementation Patterns

### 6.1 Asset Identifiers: `public_id` vs URLs
- **`public_id`**: The unique identifier of an asset in Cloudinary (e.g. `portfolio/hero` or `products/shoe_red`).
- **Critical Rule**: **NEVER include the file extension in `public_id`** (e.g. use `hero`, NOT `hero.png`). Cloudinary serves any format dynamically via URL extensions (e.g. `.../hero.webp`, `.../hero.avif`). Adding an extension creates double extensions like `hero.png.png`.
- **Folder Namespaces**: Slashes (`/`) in `public_id` define virtual folder hierarchy.

### 6.2 Resource Types
Cloudinary isolates assets into three distinct pools:
- **`image`** (default): Raster images, vector SVGs, animated GIFs.
- **`video`**: MP4, WebM, MOV, audio files (MP3, WAV).
- **`raw`**: Documents (PDF, DOCX, XLSX), archives (ZIP, TAR), fonts (WOFF2, TTF), JSON.

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
   - *Right*: `cloudinary.uploader.upload(file, { public_id: 'banner' })`

2. ❌ **NEVER leak `api_secret` or `CLOUDINARY_URL` to frontend code**
   - *Wrong*: Putting `CLOUDINARY_URL` in `NEXT_PUBLIC_` or `VITE_` env vars.
   - *Result*: Complete account compromise (anyone can delete or overwrite all assets).
   - *Right*: Client only receives `cloud_name` or calls backend endpoints for signed requests.

3. ❌ **NEVER use `resource_type: "image"` for non-images (PDFs, Audio, Fonts, Docs)**
   - *Wrong*: Uploading a PDF invoice as default resource type.
   - *Result*: Cloudinary treats it as an image, rendering failures or corrupted downloads.
   - *Right*: Always pass `resource_type: "raw"` for documents and `resource_type: "video"` for audio/video.

4. ❌ **NEVER call `api.delete_folder(folder)` without deleting assets first**
   - *Wrong*: Expecting Cloudinary Admin API `delete_folder` to delete contents.
   - *Result*: Cloudinary API throws `FolderNotEmpty` error.
   - *Right*: Delete assets first via `api.delete_resources_by_prefix(folder)` or use `cldsh rm -rf <folder>`.

5. ❌ **NEVER write files to local disk in Serverless/Container runtimes**
   - *Wrong*: `fs.writeFileSync('/tmp/' + name)` then uploading file path.
   - *Result*: Disk exhaustion, read-only filesystem errors in AWS Lambda, poor performance.
   - *Right*: Use `cloudinary.uploader.upload_stream` with buffers.

6. ❌ **NEVER deliver raw untransformed image URLs**
   - *Wrong*: `https://res.cloudinary.com/demo/image/upload/sample.jpg` (delivers massive 5MB camera original).
   - *Right*: `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1200/sample.jpg` (delivers optimized 80KB WebP/AVIF).
