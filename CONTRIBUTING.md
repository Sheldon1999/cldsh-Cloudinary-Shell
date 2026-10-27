# Contributing to cldsh

Thanks for considering a contribution. `cldsh` is a single-maintainer project;
small, focused pull requests are easiest to review and merge.

## Before you start

- For a new feature or a behavior change, open an issue first describing the
  problem and your proposed approach. Bug fixes and docs can go straight to
  a pull request.
- Check the [command table in the README](README.md#commands) isn't already
  covering your use case — `cldsh` favors one obvious way to do something
  over configurable alternatives.

## Development setup

```bash
git clone https://github.com/Sheldon1999/cldsh-Cloudinary-Shell.git
cd cldsh-Cloudinary-Shell
npm install
npm test
```

Requires **Node.js 20 or newer**. No build step: `lib/`, `commands/` and
`cldsh.js` run directly as ESM.

## Tests

Tests run against an in-memory fake Cloudinary backend
(`test/helpers/fake-cloudinary.js`) — no real account or network access is
needed or used.

```bash
npm test                               # the full suite
node --test test/upload.test.js        # a single file
```

- Each test runs with an isolated `HOME` (`test/helpers/isolate-home.mjs`), so
  it never touches your real `~/.config/cldsh` credentials or
  `~/.cldsh_history`.
- A fix or feature needs a test that fails before the change and passes
  after. Use `test/helpers/cli.js#runCli` to exercise the real `cldsh.js`
  binary against the fake backend, or `createFakeCloudinary` directly for
  unit-level tests of `lib/`.
- Tests must stay deterministic and must not reach the network or a real
  Cloudinary account.

## Code style

- Plain ESM, no TypeScript, no build step, no new runtime dependencies
  without a strong reason (`cldsh` currently depends only on `chalk` and
  `cloudinary`).
- Match the existing error shape: throw `CldshError` with a `CODES.*` from
  `lib/errors.js` rather than a plain `Error`, so the CLI, shell and MCP
  server report it consistently.
- Both Cloudinary folder modes (`fixed` and `dynamic`) are first-class — a
  storage-affecting change goes through `lib/backend/index.js`, not directly
  through the Cloudinary SDK.
- Destructive operations (delete, move, overwrite) must support `--dry-run`
  and go through the existing confirmation path
  (`lib/confirm.js` / `lib/mcp/confirm.js`) — see the "Safety" section of the
  README for the contract.

## Pull requests

- One purposeful change per PR, with a clear description of what changed and
  why.
- Update `README.md` / `INTEGRATION.md` and add a `CHANGELOG.md` entry
  ("Unreleased" section, or ask the maintainer to add one) when behavior
  changes.
- `npm test` and `npm pack --dry-run` must pass before requesting review (CI
  runs both on every PR, across Node 20/22/24 and Linux/macOS).

## Reporting a bug

Open a [GitHub issue](https://github.com/Sheldon1999/cldsh-Cloudinary-Shell/issues)
with:

- the `cldsh` version (`cldsh --version`) and Node.js version,
- the exact command (redact your cloud name and any secrets),
- what you expected vs. what happened, including the exit code and any
  `--json` output.

## Security

Please do not open a public issue for a security vulnerability (for example
a way to bypass the delete/move confirmation, or a path-sandbox escape in the
MCP server). Email the maintainer address listed in `package.json` instead.
