# Publishing `curio-agent-sdk`

This document describes how to publish the TypeScript SDK to [npm](https://www.npmjs.com/). The published package name is **`curio-agent-sdk`** (see `package.json` in this directory). The repository folder may be named `curio-agent-sdk-typescript`; npm only cares about `name` in `package.json`.

## Prerequisites

- **Node.js** `>=20` (matches `engines` in `package.json`).
- An **npm account** with permission to publish the package name (first publish claims the name; coordinate with your org if it is org-scoped later).
- **npm CLI** logged in: `npm login` (use an automation token in CI if applicable).
- **Two-factor authentication**: npm may require 2FA for publish; enable it on your account and use OTP or trusted publishing as configured.

## What gets published

The tarball includes only what `package.json` lists under `"files"`:

- `dist/` (build output)
- `README.md`
- `LICENSE`

`prepublishOnly` runs `npm run clean && npm run build`, so a fresh `dist/` is always produced before publish. You do not need to run `build` manually unless you want to verify locally first.

## Pre-publish checklist

1. **Branch and CI**: Merge intended changes; ensure CI (if any) is green.
2. **Version**: Decide semver bump (`patch` / `minor` / `major`) and update `package.json` (see [Version bumps](#version-bumps)).
3. **Quality gates** (from `README.md` / `docs/API_REFERENCE.md`):
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test:all` (or the subset you require for release)
   - `npm run docs:api` if you ship or commit generated API docs
4. **Exports**: Confirm public API in `src/index.ts` and subpath exports in `package.json` → `"exports"`.
5. **Dry run**: `npm pack --dry-run` or `npm publish --dry-run` to inspect the tarball contents.

## Publish commands

From this directory (`curio-agent-sdk-typescript`):

```bash
npm install
npm publish --access public
```

Use `--access public` if the package name is unscoped and you need public visibility (default for unscoped packages is public; scoped packages like `@org/pkg` often need `--access public` on first publish).

**Inspect before uploading:**

```bash
npm pack
tar -tzf curio-agent-sdk-*.tgz
```

**Dry run (no upload):**

```bash
npm publish --dry-run
```

## Version bumps

Prefer npm’s version helper so `package.json` and `package-lock.json` stay in sync:

```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0
```

This creates a git tag `v<version>` if the repo is clean and git is available. Push the tag with your release workflow:

```bash
git push origin main --follow-tags
```

To set a specific version:

```bash
npm version 1.2.3 --no-git-tag-version
```

## CI / automation

- Store **`NPM_TOKEN`** (or `NODE_AUTH_TOKEN`) in your CI secrets.
- In the job, set the registry and token, for example:

  ```bash
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
  npm publish --access public
  ```

- Use **npm granular access tokens** with publish scope only; rotate periodically.
- Consider **npm Trusted Publishing** (OIDC) with GitHub Actions to avoid long-lived tokens.

## Scoped or alternate registries (optional)

If you later publish under a scope (e.g. `@curio/agent-sdk`):

1. Change `"name"` in `package.json`.
2. Add `"publishConfig": { "access": "public" }` if the package should be public.

For GitHub Packages or a private registry, set `publishConfig.registry` and `.npmrc` accordingly; the rest of the flow is the same after `npm login` to that registry.

## After publish

- Confirm the version on `https://www.npmjs.com/package/curio-agent-sdk`.
- Tag the release in git if not already done by `npm version`.
- Announce breaking changes in changelog or release notes if applicable.

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| **403 / name taken** | Package name is global on npm; you need owner access or a new name. |
| **OTP required** | Enable 2FA; use `npm publish` interactively or automation with a token that allows publish. |
| **Wrong files in tarball** | Verify `"files"` in `package.json`; run `npm pack` and list archive contents. |
| **Old code shipped** | `prepublishOnly` should rebuild; ensure you did not disable scripts (`npm publish --ignore-scripts` skips them). |
