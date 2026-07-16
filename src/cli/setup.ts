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

function findHttpFile(): string | null {
  for (const name of ["http.ts", "http.js"]) {
    const path = join(process.cwd(), "convex", name);
    if (existsSync(path)) return path;
  }
  return null;
}

function createConvexConfig(): boolean {
  const configPath = join(process.cwd(), "convex", "convex.config.ts");
  const httpPath = findHttpFile();

  if (existsSync(configPath)) {
    const existing = readFileSync(configPath, "utf-8");
    if (existing.includes("@convex-dev/static-hosting")) {
      skip("convex/convex.config.ts (already configured)");
      return false;
    }
    console.log("\n⚠️  convex/convex.config.ts exists. Add manually:");
    console.log(
      '   import staticHosting from "@convex-dev/static-hosting/convex.config";',
    );
    if (httpPath) {
      console.log(
        "   app.use(staticHosting); // keep app HTTP routes at root\n",
      );
      return true;
    }
    console.log('   app.use(staticHosting, { httpPrefix: "/" });\n');
    return false;
  }

  const config = httpPath
    ? `import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// Keep existing app HTTP routes at their current root URLs.
const app = defineApp();
app.use(staticHosting);

export default app;
`
    : `import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// Your own HTTP endpoints (convex/http.ts) are served under /api so the
// static site can own the root.
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;
`;

  writeFileSync(configPath, config);
  success("Created convex/convex.config.ts");
  return httpPath !== null;
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

  const needsStaticRoutes = createConvexConfig();
  updatePackageJson();

  console.log("\n✨ Setup complete!\n");
  if (needsStaticRoutes) {
    console.log(
      "Keep existing HTTP routes at the root by adding this to convex/http.ts:\n",
    );
    console.log(
      '   import { registerStaticRoutes } from "@convex-dev/static-hosting";',
    );
    console.log('   import { components } from "./_generated/api";');
    console.log("   registerStaticRoutes(http, components.staticHosting);\n");
  }
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
