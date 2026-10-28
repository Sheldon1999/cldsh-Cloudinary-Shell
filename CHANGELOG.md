# Changelog

All notable changes to `cloudinary-shell` (`cldsh`) are listed here.

## 2.0.1 (2026-10-28)

- Added `mcpName` to `package.json` so `cldsh` can be published to the
  Official MCP Registry (`registry.modelcontextprotocol.io`). No behavior
  change.

## 2.0.0 (2026-10-27)

This release makes `cldsh` safe and correct on every Cloudinary account, including accounts created since June 2024, which use **dynamic folders**.

### Breaking changes

- **Node.js 20 or newer** is required (Node 18 is end-of-life).
- **Exit codes are honored.** A failing command exits non-zero: `1` error, `2` usage error, `3` partial failure (for example some files of a batch failed, or `rm` found a name that doesn't exist), `4` confirmation needed or cancelled. Scripts that relied on exit code `0` after a failure must handle errors.
- **Credential order.** An explicit choice wins: `--profile`, `config use` or `login` in the shell, or `CLOUDINARY_PROFILE`; then `CLOUDINARY_URL` (or the three `CLOUDINARY_*` variables); then a local `.env`; then the saved default profile. This is what the 1.0 README already described.
- **Bulk deletes ask first.** Recursive deletes, wildcard deletes and deletes of more than 20 assets show what will be deleted and ask for confirmation; emptying the whole account asks you to type the cloud name. Pass `-y` / `--yes` to skip the question; single commands run from scripts need `--yes`.
- **Listings show every resource type** (images, videos and raw files) in `ls`, `tree`, wildcards and downloads. Use `--rt=image` for the 1.0 listing.
- **Uploads pick the resource type from the file extension** (images including PDF and SVG → image, video and audio → video, everything else → raw) instead of always `image`. Raw files keep their extension in the public ID. `--rt` overrides.
- **Downloads don't overwrite** existing local files unless `-f` / `--force` (MCP: `overwrite: true`).
- **`mv` into a folder that doesn't exist** fails; create it with `mkdir` first.
- **MCP: changes take two calls.** `cloudinary_delete`, `cloudinary_move`, `cloudinary_rename_folder` and uploads that would replace existing assets first return a preview and a `confirm_token`; call again with the token to run exactly that plan. Start the server with `--no-confirm` for the 1.0 behavior.
- **MCP: local files are limited** to the server's working directory, the client's roots and `--allow-path` folders. Unknown server options stop the server instead of being ignored.
- **MCP: `resource_type` defaults to all types** in list, tree and other read tools (1.0 defaulted to `image`).

### Fixed

- Folders, listings, moves and deletes work correctly in **dynamic folder mode**: folder contents come from the asset's folder, not its public ID path, and `rm -r` never deletes assets that merely share a public ID prefix.
- `rm -r` deletes everything in a folder tree (no 1,000-asset limit; private and authenticated assets included) and reports failures instead of printing success.
- `rm` reports names that don't exist as "not found" instead of "ok".
- Paths are relative to the current folder for every command and both `mv` arguments (`rm sub/a` inside `apps` means `apps/sub/a`).
- Options no longer swallow the next word: `rm -r folder`, `upload -r ./dir` and `--dry-run 'cld*'` work in any order.
- Cloudinary error messages are shown as text instead of `[object Object]`; authentication errors are no longer reported as "No such folder".
- `--json` output piped to another program is no longer cut off at 64 KB on macOS, and `--json` errors never appear on stdout.
- Folder listings are no longer cut off after the first page.
- The API secret is never written to the shell history; the history file is private (`0600`) and old lines containing credentials are removed.
- A failed `login` no longer leaves the shell connected with the rejected credentials.
- Saving credentials is atomic, and a damaged credentials file is never overwritten (`login --reset` moves it aside).
- Removing the active or default profile no longer switches silently to another account.
- `CLOUDINARY_URL` options such as `upload_prefix` (EU/AP data centers) and private CDN settings are applied.
- Directory uploads with videos, audio and other files work.
- MCP: notifications are never answered, invalid arguments are rejected with a proper error, and the protocol version is negotiated (`2025-06-18`, `2025-03-26`, `2024-11-05`).
- Updated the Cloudinary SDK to 2.11 (fixes advisory GHSA-g4mf-96x5-5m2c).

### Added

- **Dynamic folder mode:** `mv` keeps delivery URLs (moves change the asset folder, renames change the display name); `--public-id` renames the public ID too. Folders can be moved and renamed (`mv old new`).
- `rm` and `url` accept several targets; `download` accepts several targets and a destination.
- `upload --to <folder>`, `--no-overwrite`; per-file status `created`, `overwritten`, `skipped` or `failed`; chunked upload with progress for files over 20 MB; automatic retries of temporary failures.
- Private and authenticated assets: `download` and `url --signed` use signed URLs.
- `asset_id:<id>` can be used wherever an asset name is expected; ambiguous names (an image and a video called `intro`) are listed instead of guessed.
- `quota` command: remaining Admin API requests this hour and the folder mode. A warning appears when less than 10% is left.
- `config` shows which credential sources are overridden; `login --stdin` reads the URL from stdin.
- `--folder-mode` option and `CLDSH_FOLDER_MODE` variable to override folder-mode detection (the detected mode is remembered for a day).
- `help <command>` lists every option of a command; unknown commands and options suggest the closest match.
- Tab completion for nested paths, asset names and every command's options.
- `cldsh` refuses `rm` when every name exists in the local directory, which usually means the shell expanded an unquoted wildcard.
- MCP: tools `cloudinary_mkdir`, `cloudinary_rename_folder` and `cloudinary_account`; tool annotations; `--read-only` and `--allow-path` server options; structured results for `2025-06-18` clients.
