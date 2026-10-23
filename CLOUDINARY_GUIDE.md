# Cloudinary & `cldsh` Engineering Guide (for AI Agents & Developers)

> **Audience**: AI Agents (LLMs), assistants, and engineers working on any project requiring Cloudinary integration (web apps, mobile backends, scripts, APIs, or asset pipelines).  
> **Purpose**: A single authoritative reference covering the Cloudinary mental model, secure architecture, standard implementation patterns across common tech stacks, common LLM pitfalls, and how to use `cldsh` (Cloudinary Shell) as an interactive CLI companion to inspect, manage, and verify assets during development.

---

## 1. Quick Reference: When to Use What

```
                                  ┌─────────────────────────────┐
                                  │   What is the objective?    │
                                  └──────────────┬──────────────┘
                                                 │
            ┌────────────────────────────────────┼───────────────────────────────────┐
            ▼                                    ▼                                   ▼
┌───────────────────────┐            ┌───────────────────────┐           ┌───────────────────────┐
│ Inspect / Debug / CLI │            │    Backend Upload     │           │    Frontend Upload    │
│  Use `cldsh` via npx  │            │ Node/Express/Next/Py  │           │ Direct to Cloudinary  │
├───────────────────────┤            ├───────────────────────┤           ├───────────────────────┤
│ • Explore folders     │            │ • Use Server SDK      │           │ • Signed Uploads (API)│
│ • Inspect dimensions  │            │ • Stream memory buffer│           │ • Unsigned (Presets)  │
│ • Test transforms     │            │ • Never expose secret │           │ • Never put secret in │
│ • Seed/delete assets  │            │ • Organize namespaces │           │   client bundles      │
└───────────────────────┘            └───────────────────────┘           └───────────────────────┘
```

---

## 2. Cloudinary Core Concepts & Mental Model

### 2.1 The Identity Trio
Every Cloudinary account uses three primary credentials:
1. **`cloud_name`**: Public identifier for your media repository. Visible in all CDN delivery URLs. Safe for client-side use.
2. **`api_key`**: Public API identifier. Used in authenticated requests and direct uploads. Safe for client-side use when paired with signatures.
3. **`api_secret`**: Private cryptographic secret. **NEVER expose this in client bundles, public repositories, or frontend code.**

The combined connection string format:
```text
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
```

### 2.2 Asset Identifiers: `public_id` vs URLs
- **`public_id`**: The canonical unique identifier of an asset inside Cloudinary (e.g. `avatars/user_123` or `products/shoes/sneaker_red`).
- **File Extensions in `public_id`**: **DO NOT include file extensions in `public_id`** (e.g., use `logo`, NOT `logo.png`). Cloudinary serves any format dynamically via URL extensions (e.g., `.../logo.webp`, `.../logo.png`, `.../logo.avif`). Adding an extension to the `public_id` leads to double extensions like `logo.png.png`.
- **Folder Namespaces**: Slashes (`/`) in `public_id` define virtual folder hierarchy (e.g., `apps/ecommerce/staging/banners/hero`).

### 2.3 Resource Types
Cloudinary isolates assets into three distinct pools. APIs and URLs require the correct `resource_type`:
* **`image`** (default): Raster images, vector SVGs, animated GIFs, camera raw.
* **`video`**: MP4, WebM, MOV, audio files (MP3, WAV, AAC).
* **`raw`**: Documents (PDF, DOCX, XLSX), archives (ZIP, TAR), fonts (WOFF2, TTF), JSON, plain text.

> **Rule for LLMs**: If uploading a PDF, font, or text document, you MUST explicitly specify `resource_type: 'raw'`. Failing to do so causes upload or delivery 404s.

### 2.4 Delivery Types
* **`upload`** (default): Public assets delivered globally over the CDN. Anyone with the URL can view it.
* **`authenticated`**: Restricted assets. URLs must be cryptographically signed with the `api_secret` or accessed via short-lived tokens.
* **`private`**: Restricted assets where the original file cannot be transformed or accessed without signed download URLs.

### 2.5 Dynamic CDN Transformations
Cloudinary transforms media **on the fly** through URL path parameters inserted between `/upload/` and the asset path:
```text
https://res.cloudinary.com/<cloud_name>/<resource_type>/<delivery_type>/<transformations>/v<version>/<public_id>.<format>
```

#### The Golden Optimization Baseline: `f_auto,q_auto`
Always include `f_auto,q_auto` in transformed URLs:
* **`f_auto`** (Automatic Format): Serves AVIF or WebP to modern browsers, falling back to JPEG/PNG for older ones.
* **`q_auto`** (Automatic Quality): Applies perceptual compression that minimizes bytes without visual degradation.

---

## 3. Using `cldsh` as the Developer & AI Companion Tool

`cldsh` is an interactive virtual shell for Cloudinary. When working on a project, developers and AI agents can run `cldsh` to inspect, upload, verify, and clean up assets without opening the Cloudinary web console.

### 3.1 Launching `cldsh` (Zero Install)
```bash
# Run directly via npx (picks up CLOUDINARY_URL from active env or .env)
npx cldsh

# Or install globally
npm install -g cldsh
cldsh
```

### 3.2 Authentication & Profile Management
`cldsh` resolves credentials in this order:
$$\text{Active Session Profile} \to \text{Environment Variables} \to \text{Local } .env \to \text{Global Store } (\texttt{\textasciitilde/.config/cldsh/credentials.json})$$

```bash
# Connect interactively or by connection string
$~ login
$~ login default "cloudinary://<api_key>:<api_secret>@<cloud_name>"

# Multi-account/environment management (dev, staging, prod)
$~ login dev "cloudinary://<key>:<secret>@<dev-cloud>"
$~ login prod "cloudinary://<key>:<secret>@<prod-cloud>"

# List and switch profiles
$~ config ls
$~ config use prod

# View active config (secrets are masked)
$~ config
```

### 3.3 Essential `cldsh` Commands Reference Table

| Command | Syntax | Description & Example |
| :--- | :--- | :--- |
| **`ls`** | `ls [path] [-l] [--rt=image]` | List contents. `-l` displays size (KB), dimensions (px), name, and format. `ls apps/hero -l` |
| **`cd`** | `cd [folder \| .. \| / \| ~ \| -]` | Navigate virtual folders. `cd /` (root), `cd ..` (up), `cd -` (toggle back). |
| **`pwd`** | `pwd` | Print current folder path. |
| **`tree`** | `tree [-d N] [--rt=image]` | Render ASCII folder hierarchy up to depth `N`. `tree -d 2` |
| **`mkdir`** | `mkdir <name>` | Create a subfolder. `mkdir avatars` |
| **`upload`** | `upload <path\|dir> [name] [-o] [--rt=image] [-v]` | Upload local file or entire folder (batch). `-o` overwrites. `upload ./logo.svg brand-logo` |
| **`download`**| `download <name\|public_id> [dest] [--rt=image]` | Download asset to local disk. `download hero ./public/hero.png` |
| **`info`** | `info <name\|public_id> [--rt=image] [-v]` | Display complete asset metadata card (dimensions, bytes, format, dates, tags). |
| **`url`** | `url <name\|public_id> [--t="..."] [--signed]` | Print CDN URL with optional transforms. `url banner --t="f_auto,q_auto,w_800"` |
| **`open`** | `open <name\|public_id> [--t="..."]` | Open asset in default web browser. `open hero --t="w_1200"` |
| **`rm`** | `rm <name\|public_id> [--rt=image]` | Delete a single asset. `rm hero` |
| **`rm -rf`** | `rm -rf <folder>` | Recursively delete a folder and all its contents. `rm -rf temp-uploads` |

### 3.4 Common Development Workflows with `cldsh`
1. **Verifying Assets Before Writing Frontend Code**:
   ```bash
   $~/assets ls -l
   $~/assets info product-card
   ```
2. **Seeding Test Images into a Project**:
   ```bash
   $~/app/dev/seed upload ./fixtures/samples
   ```
3. **Generating Optimized URLs for Mockups or Seed Data**:
   ```bash
   $~/app/banners url hero --t="f_auto,q_auto,c_fill,w_1200,h_630"
   ```
4. **Purging Temporary Test Runs**:
   ```bash
   $~/app rm -rf test-run-42
   ```

---

## 4. Secure Environment & Configuration Setup

### 4.1 Server vs Client Environment Variables
```bash
# ==========================================
# 1. SERVER-SIDE ONLY (.env / secrets manager)
# NEVER prefix with NEXT_PUBLIC_ or VITE_
# ==========================================
CLOUDINARY_URL=cloudinary://123456789012345:abcdefghijklmnopqrstuvw_xyz@my-cloud-name
# OR separate variables:
CLOUDINARY_CLOUD_NAME=my-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=abcdefghijklmnopqrstuvw_xyz

# ==========================================
# 2. CLIENT-SIDE (Browser Safe)
# Only Cloud Name or Upload Preset. NO SECRETS.
# ==========================================
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=my-cloud-name
# If using unsigned direct uploads:
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=user_avatars_unsigned
```

### 4.2 Folder Namespacing Best Practice
Structure asset `public_id`s with an explicit hierarchy:
$$\texttt{<project-name> / <environment> / <entity> / <identifier>}$$
* Example: `shopflow/production/products/prod_98765`
* Example: `shopflow/staging/avatars/user_102`

---

## 5. Implementation Code Patterns by Tech Stack

### 5.1 Node.js / Express / Backend API (Buffer Upload via Streams)
Avoid writing temporary files to disk (essential for Docker, Serverless, and AWS Lambda). Stream files directly from memory buffers (e.g., Multer memory storage):

```typescript
// lib/cloudinary.ts
import { v2 as cloudinary, type UploadApiResponse, type UploadApiOptions } from 'cloudinary';

// Automatically reads CLOUDINARY_URL from process.env if set
cloudinary.config({
  secure: true,
});

/**
 * Uploads a Buffer (from multer, fetch, or memory) to Cloudinary via stream.
 */
export function uploadBufferToCloudinary(
  buffer: Buffer,
  options: UploadApiOptions = {}
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: options.resource_type || 'auto',
        folder: options.folder || 'uploads',
        overwrite: options.overwrite ?? true,
        ...options,
      },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Cloudinary upload returned undefined.'));
        }
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Deletes an asset by public_id.
 */
export async function deleteCloudinaryAsset(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image'
) {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
```

**Express Route Handler Example:**
```typescript
// routes/upload.ts
import { Router } from 'express';
import multer from 'multer';
import { uploadBufferToCloudinary } from '../lib/cloudinary.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const router = Router();

router.post('/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided.' });
    }

    const userId = req.body.userId || 'anonymous';
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: `myapp/avatars`,
      public_id: `user_${userId}`,
      overwrite: true,
      transformation: [{ width: 500, height: 500, crop: 'fill', gravity: 'face' }],
    });

    return res.json({
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Upload failed.' });
  }
});
```

---

### 5.2 Next.js (App Router, Server Actions & Delivery)

#### Server Action Upload Handler
```typescript
// app/actions/upload.ts
'use server';

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({ secure: true });

export async function uploadImageAction(formData: FormData) {
  const file = formData.get('file') as File | null;
  if (!file) {
    throw new Error('No file provided');
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: 'nextapp/uploads',
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    ).end(buffer);
  });
}
```

#### Client Rendering with Next.js Image Component
You can construct optimized Cloudinary URLs using standard helper functions or `next-cloudinary`:

```tsx
// components/CloudinaryImage.tsx
import Image from 'next/image';

interface CloudinaryImageProps {
  publicId: string;
  alt: string;
  width: number;
  height: number;
  crop?: string;
  className?: string;
}

export function CloudinaryImage({
  publicId,
  alt,
  width,
  height,
  crop = 'fill',
  className,
}: CloudinaryImageProps) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  
  // Clean public_id of leading slashes
  const cleanId = publicId.replace(/^\/+/, '');
  
  // Insert f_auto, q_auto, sizing, and crop
  const transform = `f_auto,q_auto,w_${width},h_${height},c_${crop}`;
  const src = `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${cleanId}`;

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading="lazy"
    />
  );
}
```

---

### 5.3 Client-Side Direct Uploads (Browser $\to$ Cloudinary)

When handling large files (e.g. video or high-res images), route traffic directly from the user's browser to Cloudinary's upload API to eliminate server bandwidth bottlenecks.

#### Pattern A: Signed Uploads (Recommended & Secure)
1. Frontend requests signature params from your backend.
2. Backend computes HMAC-SHA1 signature using `api_secret`.
3. Frontend posts form directly to `https://api.cloudinary.com/v1_1/<cloud_name>/auto/upload`.

```typescript
// 1. Backend Route: app/api/sign-upload/route.ts (Next.js / Express)
import { v2 as cloudinary } from 'cloudinary';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { folder, public_id } = await req.json();
  const timestamp = Math.round(new Date().getTime() / 1000);

  const paramsToSign: Record<string, any> = {
    timestamp,
    folder,
  };
  if (public_id) paramsToSign.public_id = public_id;

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET!
  );

  return NextResponse.json({
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  });
}
```

```typescript
// 2. Frontend Upload Call: lib/uploadDirect.ts
export async function uploadDirectToCloudinary(file: File, folder: string) {
  // Step 1: Get signature from your backend
  const signRes = await fetch('/api/sign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  });
  const { signature, timestamp, apiKey, cloudName } = await signRes.json();

  // Step 2: POST directly to Cloudinary
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', folder);

  const uploadRes = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    {
      method: 'POST',
      body: formData,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json();
    throw new Error(err?.error?.message || 'Direct upload failed.');
  }

  return uploadRes.json(); // returns secure_url, public_id, etc.
}
```

---

### 5.4 Python (FastAPI / Django)

```python
# lib/cloudinary_service.py
import cloudinary
import cloudinary.uploader
import cloudinary.api
from fastapi import UploadFile

# Automatically configures from os.environ["CLOUDINARY_URL"]
cloudinary.config(secure=True)

def upload_file_stream(file: UploadFile, folder: str = "uploads") -> dict:
    """Uploads a FastAPI UploadFile stream directly to Cloudinary."""
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

def generate_optimized_url(public_id: str, width: int = 800, height: int = 600) -> str:
    """Generates an optimized delivery URL with smart cropping."""
    url, _ = cloudinary.utils.cloudinary_url(
        public_id,
        fetch_format="auto",
        quality="auto",
        width=width,
        height=height,
        crop="fill",
        gravity="auto",
        secure=True
    )
    return url
```

---

## 6. Transformation Reference & URL Syntax

Transform parameters are comma-separated within transformation components:

```text
https://res.cloudinary.com/<cloud>/image/upload/<transformations>/<public_id>.<format>
```

### Common Transformation Recipes

| Use Case | Transformation String | Explanation |
| :--- | :--- | :--- |
| **Universal Base** | `f_auto,q_auto` | Modern format + perceptual quality compression. |
| **Smart Content Crop** | `f_auto,q_auto,c_fill,g_auto,w_800,h_500` | Fills exact 800x500 box using AI saliency/focus detection. |
| **User Avatar (Circle)** | `f_auto,q_auto,c_thumb,g_face,w_200,h_200,r_max` | Centers on human face, crops to 200x200 square, `r_max` rounds to full circle. |
| **Responsive Downscale** | `f_auto,q_auto,c_limit,w_1200` | Downscales to max width 1200px; never upscales smaller images. |
| **Fixed Width (Fit)** | `f_auto,q_auto,c_fit,w_600` | Fits within 600px maintaining original aspect ratio. |
| **Blur Background Pad** | `f_auto,q_auto,c_pad,w_800,h_800,b_auto:predominant` | Pads image to 800x800 square using blurred predominant colors. |
| **Watermark Overlay** | `l_brand-logo,w_100,g_south_east,x_10,y_10` | Overlays `brand-logo` asset at bottom right with 10px margin. |

---

## 7. Critical LLM Pitfalls & Anti-Patterns (The "Do Not Do" Checklist)

When generating code or architecture for Cloudinary, AI models frequently make the following mistakes. **Enforce these rules:**

1. ❌ **NEVER include the file extension in `public_id`**
   - *Wrong*: `cloudinary.uploader.upload(file, { public_id: 'banner.png' })`
   - *Result*: Asset is stored with ID `banner.png`. Rendering `<img src=".../banner.png.png">` or transformations break.
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

7. ❌ **NEVER use synchronous upload for files > 100MB**
   - *Wrong*: Uploading 500MB videos with standard `upload`.
   - *Result*: Network timeouts and dropped connections.
   - *Right*: Use `cloudinary.uploader.upload_large(path, { chunk_size: 6_000_000 })`.

---

## 8. Step-by-Step Scenario Guides for AI Coding

### Scenario A: "User says: Add Cloudinary upload to our Express / NestJS backend"
1. Verify `CLOUDINARY_URL` exists in `.env`.
2. Install `cloudinary` (`npm i cloudinary`).
3. Set up Multer with `multer.memoryStorage()`.
4. Create `uploadBufferToCloudinary` using `cloudinary.uploader.upload_stream`.
5. Organize uploads into namespaces (e.g., `folder: '<app>/<feature>'`).
6. Store the returned `public_id` and `secure_url` in the database.
7. Use `npx cldsh` in the terminal to inspect the uploaded folder (`ls -l`).

### Scenario B: "User says: We need responsive avatars in React / Next.js"
1. Expose ONLY `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` to the client.
2. In the rendering component, build the URL with:
   `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto,c_thumb,g_face,w_${size},h_${size},r_max/${publicId}`
3. Handle default fallback avatar when `publicId` is null/empty.
4. Preview the transformation using `cldsh`:
   `npx cldsh url <publicId> --t="f_auto,q_auto,c_thumb,g_face,w_200,h_200,r_max"`

### Scenario C: "User says: Check what Cloudinary assets we already have"
1. Run `npx cldsh`.
2. Run `pwd` to check current location.
3. Run `tree -d 3` to get an overview of the folder hierarchy.
4. Run `ls -l` in specific folders to check image dimensions, formats, and sizes.
5. Run `info <asset_name>` for deep metadata (created date, delivery type, tags).
6. Run `view <asset_name>` to display the image directly in the terminal (Warp, iTerm2, VS Code).
7. Run `upload ./dir -r` for recursive batch uploads with concurrency and collision protection.
---

## 9. `cldsh` Complete Command Cheatsheet

| Command | Description | Example |
| :--- | :--- | :--- |
| **`login [profile]`** | Authenticate Cloudinary credentials (`CLOUDINARY_URL` or keys) | `login` or `login default "cloudinary://..."` |
| **`config`** | View active profile, cloud name, and masked secrets | `config` / `config ls` / `config use prod` |
| **`ls [path\|glob]`** | List folders and assets with wildcards | `ls -l` / `ls cld*` / `ls *.png` |
| **`cd [path]`** | Navigate Cloudinary folder hierarchy (`..`, `/`, `~`, `-`) | `cd apps/my-app` / `cd ..` / `cd /` |
| **`pwd`** | Display current Cloudinary folder path | `pwd` |
| **`lcd [dir]`** | Change local machine working directory | `lcd ~/Pictures` / `lcd ./assets` |
| **`lpwd`** | Display current local directory on machine | `lpwd` |
| **`mkdir <name>`** | Create a subfolder in Cloudinary | `mkdir screenshots` |
| **`upload <path\|dir>`**| Upload file or directory (`-r` recursive, collision-safe) | `upload ./dist -r` / `upload pic.png hero` |
| **`download <name\|glob>`** | Download remote assets to local disk | `download hero ./public/` / `download cld*` |
| **`mv <src> <dest>`** | Move or rename asset within or across folders | `mv old new` / `mv hero archive/` |
| **`info <name>`** | Inspect complete asset metadata (dimensions, size, tags) | `info logo` / `info logo -v` |
| **`view <name>`** | Render image/video thumbnail **directly in terminal** | `view hero` / `view hero --t="w_300"` |
| **`open <name>`** | Open asset CDN URL in default web browser | `open hero` |
| **`url <name\|glob>`**| Print optimized CDN URL with transformations | `url hero --t="f_auto,q_auto,w_800"` |
| **`rm <name\|glob>`** | Delete single or matching assets | `rm hero` / `rm cld*` / `rm *.png` |
| **`rm -rf <dir\|glob>`**| Recursively delete folders and contents | `rm -rf old-folder` / `rm -rf test*` |
| **`tree [-d N]`** | ASCII tree hierarchy visualization | `tree -d 2` |
| **`--dry-run`** | Preview destructive / batch actions safely | `upload ./dir -r --dry-run` / `rm cld* --dry-run` |
