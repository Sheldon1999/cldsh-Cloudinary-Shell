# Cloudinary Shell (`cldsh`) — Engineering Plan & Roadmap

## Architecture Overview
`cldsh` is an interactive Node.js REPL (Node 18+ ESM) designed to provide a Unix-style virtual filesystem interface over Cloudinary's Admin and Upload APIs.

---

## Phase 1: Interactive REPL Shell Experience (Core Usability)

### Subphase 1.1: Tab Autocompletion (`cldsh.js` + `lib/completer.js`)
- **Objective**: Pressing `<Tab>` autocomplete commands, flags, and remote folder names.
- **Details**:
  - Implement a readline `completer(line)` function.
  - Line with 0-1 tokens: complete matching command names (`ls`, `cd`, `mkdir`, `upload`, `rm`, `pwd`, `tree`, `url`, `info`, `download`, `open`, `exit`, `quit`).
  - Contextual completion:
    - After `cd `, `rm -rf `, `ls `: query Cloudinary for subfolders in `cwd` and complete matching folder names.
    - Cache folder listings in session with short TTL or invalidate on `mkdir`/`rm` to keep autocomplete fast and avoid API rate limits.
    - After `--`: complete known flags (`--rt=`, `--signed`, `--max=`, `--type=`).
- **Acceptance Criteria**:
  - `c<Tab>` completes to `cd`.
  - `cd <Tab>` shows/completes subfolders under current directory.

### Subphase 1.2: Persistent Command History (`lib/history.js`)
- **Objective**: Retain shell command history across sessions.
- **Details**:
  - Store history in `~/.cldsh_history` (with fallback to local `.cldsh_history` if home is unwritable).
  - On shell start: read file, populate `rl.history` array.
  - On line entry / shell exit: append new commands, skip consecutive duplicates, cap file size at 1,000 entries.
- **Acceptance Criteria**:
  - Exiting shell and relaunching allows pressing Up arrow to navigate prior session commands.

### Subphase 1.3: Navigation & Path Resolution Enhancements (`commands/cd.js`)
- **Objective**: Shell-standard navigation primitives.
- **Details**:
  - `cd ~` navigates to root `""`.
  - `cd /` navigates to root `""`.
  - `cd -` navigates to previous working directory (`ctx.prevCwd`).
  - Support multi-segment relative paths: `cd folder1/folder2`.
  - Support leading `/` absolute paths: `cd /folder1/folder2`.
- **Acceptance Criteria**:
  - `cd apps/my-app` works from root; `cd /` resets to root; `cd -` toggles back.

---

## Phase 2: Enhanced Asset & Folder Inspection

### Subphase 2.1: Targeted `ls [path]` & Deterministic Sorting (`commands/ls.js`)
- **Objective**: List arbitrary folders and guarantee clean output sorting.
- **Details**:
  - Accept optional folder argument: `ls [path]` (e.g. `ls ..`, `ls apps`, `ls /`).
  - Sort entries: folders first in alphabetical order, followed by files in alphabetical order.
- **Acceptance Criteria**:
  - `ls apps` lists contents of `apps` without changing cwd.

### Subphase 2.2: `info <asset>` Command (`commands/info.js`)
- **Objective**: View comprehensive asset metadata.
- **Details**:
  - Fetch detailed resource info via `cloudinary.api.resource(publicId)`.
  - Display formatted card: Public ID, Format, Dimensions, File Size, Created Date, Delivery Type, Tags, Version, CDN URL.
- **Acceptance Criteria**:
  - `info logo` prints clean formatted table/card of asset attributes.

### Subphase 2.3: `open <asset|folder>` Command (`commands/open.js`)
- **Objective**: Jump straight from terminal to browser.
- **Details**:
  - Cross-platform URL opener (macOS `open`, Linux `xdg-open`, Windows `start`).
  - Opening an asset launches its CDN URL in browser.
  - Opening a folder launches Cloudinary Media Library at that folder path.
- **Acceptance Criteria**:
  - `open hero` launches browser to view the asset.

---

## Phase 3: Asset Transfer & Management Enhancements

### Subphase 3.1: `download <asset> [destination]` Command (`commands/download.js`)
- **Objective**: Download assets from Cloudinary to local machine.
- **Details**:
  - Resolve asset CDN URL (or download URL for private assets).
  - Stream response to local file path (defaults to current local directory + basename).
- **Acceptance Criteria**:
  - `download logo` downloads `logo.png` locally with confirmation message.

### Subphase 3.2: Batch Uploads (`commands/upload.js`)
- **Objective**: Upload multiple assets or directory contents.
- **Details**:
  - Support directory path or glob patterns for local uploads.
  - Sequential or throttled concurrent uploads with per-file progress reporting.
- **Acceptance Criteria**:
  - `upload ./images/*.png` uploads all matching local images.

---

## Phase 4: Automated Testing & Developer Experience

### Subphase 4.1: Comprehensive Unit Tests (`test/*.test.js`)
- **Objective**: Complete test coverage for all parsers, completers, navigation, and formatting.
- **Details**:
  - Tests for `parseLine` with edge cases.
  - Tests for tab completer matching logic.
  - Tests for path normalization and history management.
  - Zero external test dependencies (native `node:test` + `node:assert`).

### Subphase 4.2: GitHub Actions CI Workflow (`.github/workflows/ci.yml`)
- **Objective**: Continuous integration on GitHub.
- **Details**:
  - Run tests on push and pull request across Node.js 18, 20, and 22.

### Subphase 4.3: Synchronized Documentation
- **Objective**: Keep user documentation completely up to date.
- **Details**:
  - Synchronize `README.md` and `commands/help.js` for every new command and flag.

---

## Phase 5: Secure Credential Management & Multi-Profile Support

### Subphase 5.1: Secure Storage Engine (`lib/credentials.js`)
- **Objective**: Out-of-tree credential storage with strict POSIX file permissions (CWE-732 prevention).
- **Details**:
  - Storage path: `~/.config/cldsh/credentials.json` (Unix/macOS) or `%APPDATA%\cldsh\credentials.json` (Windows).
  - Enforce directory permissions `0700` (`rwx------`: owner only).
  - Enforce file permissions `0600` (`rw-------`: owner read/write only).
  - Permission audit: On startup, check permissions; auto-correct or warn if group/world readable.
  - Support named profile dictionary schema:
    ```json
    {
      "current_profile": "default",
      "profiles": {
        "default": { "cloud_name": "...", "api_key": "...", "api_secret": "..." }
      }
    }
    ```
- **Acceptance Criteria**:
  - Newly created credentials file has `0600` permissions.
  - File is located in user home directory, completely outside of Git tracking.

### Subphase 5.2: Resolution Precedence & Guided Fallback Wizard
- **Objective**: Resilient credential discovery without abrupt crashes.
- **Details**:
  - Strict precedence order:
    1. Active session profile / `--profile <name>` flag.
    2. System environment variable (`CLOUDINARY_URL` or `CLOUDINARY_*`).
    3. Local `.env` in current project directory (backwards-compatible).
    4. Global profile (`~/.config/cldsh/credentials.json`).
  - Non-crashing fallback: If credentials are missing, do not `process.exit(1)`; launch an interactive onboarding wizard prompting the user to paste `CLOUDINARY_URL` or run `login`.
- **Acceptance Criteria**:
  - Running `cldsh` on a brand new machine prompts for setup instead of crashing.

### Subphase 5.3: `login` and `config` Commands (`commands/login.js`, `commands/config.js`)
- **Objective**: Full profile management with secret obfuscation.
- **Details**:
  - `login [profile]`: Prompt for credentials, test connection with `cloudinary.api.ping()`, and save to global store.
  - `config`: Print active account details with masked secrets (`api_secret: ***************yzA`).
  - `config list`: List all saved profiles with an asterisk `*` marking the active profile.
  - `config use <profile>`: Switch active profile and re-initialize Cloudinary client live.
  - `config rm <profile>`: Delete a saved profile.
- **Acceptance Criteria**:
  - `config` never exposes plaintext secrets.
  - Users can switch between `staging` and `prod` profiles inside the shell.

### Subphase 5.4: Account Visual Indicator in Prompt
- **Objective**: Prevent accidental destruction of production assets.
- **Details**:
  - Incorporate the active cloud name or profile into the shell prompt:
    `[my-cloud]$~/apps `
- **Acceptance Criteria**:
  - The prompt explicitly shows which Cloudinary account is active at all times.

---

## Phase 6: Core Decoupling & Headless CLI Engine (v1.0.0-alpha)

### Subphase 6.1: Core Action / Presenter Architecture Refactoring
- **Objective**: Decouple business logic from terminal rendering so actions return pure structured data.
- **Details**:
  - Establish pure async action modules (`lib/actions/*.js`):
    - `actionList(path, options)` -> `{ folders: string[], files: Asset[] }`
    - `actionUpload(localPath, options)` -> `{ public_id, url, secure_url, format, bytes }`
    - `actionInfo(publicId, options)` -> Full Cloudinary resource metadata object
    - `actionDelete(target, options)` -> `{ target, deleted: boolean, type: 'asset'|'folder' }`
    - `actionUrl(publicId, options)` -> `{ url, secure_url }`
    - `actionTree(folder, options)` -> Nested tree node hierarchy `{ name, files, dirs }`
  - Keep presentation logic (Chalk, table padding, tree connectors) strictly in caller presenters.
- **Acceptance Criteria**:
  - Actions are completely decoupled from `console.log` / `printer` and directly testable with assertions.

### Subphase 6.2: Headless CLI Mode Dispatcher (`cldsh <command> [args]`)
- **Objective**: Execute single commands non-interactively for bash scripts, Makefiles, and CI.
- **Details**:
  - Evaluate `process.argv.slice(2)` on process startup:
    - If arguments are present and `--mcp` is not specified, run in Headless CLI mode.
    - If no arguments, launch interactive REPL.
  - UNIX stdio hygiene:
    - Command output written to `process.stdout`.
    - Diagnostic messages, warnings, and errors written to `process.stderr`.
    - Exit codes: `0` on success, `1` on error.
- **Acceptance Criteria**:
  - `cldsh ls apps` runs once, outputs to terminal, and exits with code `0`.
  - `cldsh ls non-existent` writes error to `stderr` and exits with code `1`.

### Subphase 6.3: Structured JSON Output Pipeline (`--json`)
- **Objective**: Enable machine-readable output for `jq` and automation pipelines.
- **Details**:
  - Global `--json` flag supported across all headless commands.
  - When `--json` is passed, serialize raw action result with `JSON.stringify(data, null, 2)` to `stdout`.
  - Suppress headers, chalk colors, and decorative text when in JSON mode.
- **Acceptance Criteria**:
  - `cldsh ls --json | jq '.files[].public_id'` successfully extracts IDs.
  - `cldsh info logo --json` returns valid JSON metadata object.

### Subphase 6.4: Headless CLI Automated Test Suite
- **Objective**: Verify CLI exit codes and output streams.
- **Details**:
  - End-to-end integration tests spawning `node cldsh.js <cmd>` via child process.
  - Verify stdout / stderr separation and JSON parsing.

---

## Phase 7: Native Model Context Protocol (MCP) Server (AI Agent Integration)

### Subphase 7.1: MCP Server Core & stdio Transport (`lib/mcp.js`)
- **Objective**: Provide a native MCP server for Claude Desktop, Cursor, and Copilot.
- **Details**:
  - Implement stdio JSON-RPC server using `@modelcontextprotocol/sdk`.
  - Strict stdout hygiene: Stdout reserved exclusively for JSON-RPC messages; all internal logs routed to `stderr`.
  - Invoked via: `cldsh --mcp`.
- **Acceptance Criteria**:
  - `cldsh --mcp` successfully initializes MCP protocol handshake over stdio.

### Subphase 7.2: MCP Tool Definitions & JSON Schema Declarations
- **Objective**: Provide atomic, deterministic tools to eliminate LLM hallucinations.
- **Exposed Tools**:
  1. `cloudinary_list`: Browse folders and assets with filtering.
     - Parameters: `path` (string, optional), `resource_type` (enum: image/video/raw), `max` (number).
  2. `cloudinary_upload`: Upload a local file or remote URL into Cloudinary.
     - Parameters: `local_path` (string), `public_id` (string, optional), `folder` (string, optional), `overwrite` (boolean).
  3. `cloudinary_get_url`: Retrieve optimized CDN URL or generate on-the-fly transformations.
     - Parameters: `public_id` (string), `transformation` (string, optional), `signed` (boolean).
  4. `cloudinary_info`: Inspect asset metadata (dimensions, bytes, format, tags, created timestamp).
     - Parameters: `public_id` (string), `resource_type` (enum).
  5. `cloudinary_delete`: Permanently delete a single asset or recursively purge a folder.
     - Parameters: `target` (string), `recursive` (boolean).
  6. `cloudinary_tree`: Get structural folder tree hierarchy.
     - Parameters: `folder` (string, optional), `depth` (number, optional).
- **Acceptance Criteria**:
  - Tools return structured text/JSON blocks conforming to the MCP specification.

### Subphase 7.3: Unified Authentication & Multi-Profile Support in MCP
- **Objective**: Zero-configuration setup for AI clients.
- **Details**:
  - MCP server inherits existing credentials from `~/.config/cldsh/credentials.json`.
  - Support `--profile <name>` flag in MCP launcher arguments:
    `npx -y cldsh --mcp --profile work-prod`
- **Acceptance Criteria**:
  - Adding `npx -y cldsh --mcp` to Claude Desktop works instantly with existing logged-in credentials.

### Subphase 7.4: MCP Integration Testing
- **Objective**: Validate tool execution and schema validation.
- **Details**:
  - Automated test simulating JSON-RPC `tools/list` and `tools/call`.

---

## Phase 8: Dual-Audience Documentation & v1.0 Packaging

### Subphase 8.1: Claude Desktop & Cursor Integration Guides
- **Objective**: Step-by-step setup documentation for developers using AI assistants.
- **Details**:
  - Example configurations for `claude_desktop_config.json`.
  - Example configurations for Cursor IDE Custom Tools.

### Subphase 8.2: Scripting & Automation Documentation
- **Objective**: Document Headless CLI usage for CI/CD and shell scripts.
- **Details**:
  - Examples for GitHub Actions, bash scripts, and `jq` recipes.

### Subphase 8.3: v1.0.0 Release Verification & Security Audit
- **Objective**: Final release readiness checklist.
- **Details**:
  - Verify package tarball contains zero secrets, clean permissions, and all three operational modes.
