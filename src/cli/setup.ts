#!/usr/bin/env node
/**
 * Setup wizard for Convex Static Hosting.
 *
 * Usage:
 *   npx @convex-dev/static-hosting setup
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

function success(msg: string): void {
  console.log(`✓ ${msg}`);
}

function skip(msg: string): void {
  console.log(`· ${msg}`);
}

function createConvexConfig(): void {
  const configPath = join(process.cwd(), "convex", "convex.config.ts");

  if (existsSync(configPath)) {
    const existing = readFileSync(configPath, "utf-8");
    if (existing.includes("@convex-dev/static-hosting")) {
      skip("convex/convex.config.ts (already configured)");
      return;
    }
    console.log("\n⚠️  convex/convex.config.ts exists. Add manually:");
    console.log(
      '   import staticHosting from "@convex-dev/static-hosting/convex.config";',
    );
    console.log('   app.use(staticHosting, { httpPrefix: "/" });\n');
    return;
  }

  writeFileSync(
    configPath,
    `import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
app.use(staticHosting, { httpPrefix: "/" });

export default app;
`,
  );
  success("Created convex/convex.config.ts");
}

function updatePackageJson(): void {
  const pkgPath = join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) {
    console.log("⚠️  No package.json found");
    return;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (!pkg.scripts) pkg.scripts = {};

  if (pkg.scripts.deploy) {
    skip("package.json deploy script (already exists)");
    return;
  }

  pkg.scripts.deploy = "npx @convex-dev/static-hosting deploy";
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  success("Added deploy script to package.json");
}

function main(): void {
  console.log("\n🚀 Convex Static Hosting Setup\n");

  if (!existsSync("convex")) {
    mkdirSync("convex");
    success("Created convex/ directory");
  }

  createConvexConfig();
  updatePackageJson();

  console.log("\n✨ Setup complete!\n");
  console.log("Next steps:\n");
  console.log("  1. npx convex dev          # Generate types");
  console.log("  2. npm run deploy          # Build and deploy\n");
  console.log("Your app will be at: https://<deployment>.convex.site\n");
  console.log(
    "Optional: to use <UpdateBanner /> from @convex-dev/static-hosting/react,",
  );
  console.log("create convex/staticHosting.ts:\n");
  console.log(
    '   import { exposeDeploymentQuery } from "@convex-dev/static-hosting";',
  );
  console.log('   import { components } from "./_generated/api";');
  console.log(
    "   export const { getCurrentDeployment } = exposeDeploymentQuery(",
  );
  console.log("     components.staticHosting,");
  console.log("   );\n");
}

main();
