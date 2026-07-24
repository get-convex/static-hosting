# Publishing

Publishing is a maintainer-run npm workflow. You need publish access to the
`@convex-dev/static-hosting` package and an authenticated npm session.

## Before a release

1. Start from the exact commit you intend to publish and make sure its checks
   are green.
2. Confirm npm access:

   ```sh
   npm whoami
   ```

3. Recreate dependencies and generated output from the lockfile:

   ```sh
   npm ci
   npm run build:clean
   ```

4. Run the release checks and inspect the package contents:

   ```sh
   npm test
   npm run lint
   npm run typecheck
   npm pack --dry-run --json
   ```

   The package preview must include `dist/cli/index.js`, the public type
   declarations, `INTEGRATION.md`, and `CHANGELOG.md`.

5. For a major migration, install the preview package in a real app before
   publishing. Verify backend codegen/deploy, the first asset upload, a second
   upload, root HTTP routes, SPA fallback, and hashed assets.

Do not try to publish a version that already exists on npm. Always create the
version commit and tag first with `npm version` or one of the scripts below.

## Release lifecycle scripts

- `prepare` force-builds `dist/`. It runs for package previews, npm publishing,
  and Git-based installs.
- `preversion` installs from the lockfile, regenerates component code, builds,
  and runs tests, lint, and typechecking.
- `version` opens `CHANGELOG.md` in Vim, formats it, and stages it before npm
  creates the version commit and tag. This step is interactive.

## Publish the next alpha

```sh
npm run alpha
```

This increments the current prerelease (for example, `0.2.0-alpha.0` to
`0.2.0-alpha.1`), publishes it with the `alpha` dist-tag, and pushes the version
commit and tag. Users can install it with:

```sh
npm install @convex-dev/static-hosting@alpha
```

## Publish a stable release

When the current version is a prerelease, `npm run release` removes the
prerelease suffix, publishes the resulting version as `latest`, and pushes the
version commit and tag:

```sh
npm run release
```

For an explicit version or a minor/major bump, run the steps manually:

```sh
npm version 0.2.0 # or: npm version minor / major
npm publish --access public
git push --follow-tags
```

Before confirming the publish, inspect the version produced by `npm version` and
make sure it is the release you intend to expose as `latest`.

## Build a one-off package

```sh
npm ci
npm run build:clean
npm pack
```

Install the resulting tarball in another project with
`npm install ./path/to/convex-dev-static-hosting-<version>.tgz`.
