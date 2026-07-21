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

interface ConfigSetupResult {
  needsStaticRoutes: boolean;
  requiresManualConfig: boolean;
}

function createConvexConfig(): ConfigSetupResult {
  const configPath = join(process.cwd(), "convex", "convex.config.ts");
  const httpPath = findHttpFile();

  if (existsSync(configPath)) {
    const existing = readFileSync(configPath, "utf-8");
    if (existing.includes("@convex-dev/static-hosting")) {
      skip("convex/convex.config.ts (already imports static hosting)");
      console.log(
        "⚠️  Verify that the component has either an httpPrefix mount or a matching registerStaticRoutes call in convex/http.ts.",
      );
      console.log(
        "   Also note any custom app.use(..., { name }) value for the --component flag.\n",
      );
      return { needsStaticRoutes: false, requiresManualConfig: true };
    }
    console.log("\n⚠️  convex/convex.config.ts exists. Add manually:");
    console.log(
      '   import staticHosting from "@convex-dev/static-hosting/convex.config";',
    );
    if (httpPath) {
      console.log(
        "   app.use(staticHosting); // keep app HTTP routes at root\n",
      );
      return { needsStaticRoutes: true, requiresManualConfig: true };
    }
    console.log('   app.use(staticHosting, { httpPrefix: "/" });\n');
    return { needsStaticRoutes: false, requiresManualConfig: true };
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
  return {
    needsStaticRoutes: httpPath !== null,
    requiresManualConfig: false,
  };
}

function updatePackageJson(): boolean {
  const pkgPath = join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) {
    console.log("⚠️  No package.json found");
    return false;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (!pkg.scripts) pkg.scripts = {};

  if (pkg.scripts.deploy) {
    skip("package.json deploy script (already exists)");
    return (
      typeof pkg.scripts.deploy === "string" &&
      pkg.scripts.deploy.includes("@convex-dev/static-hosting")
    );
  }

  pkg.scripts.deploy = "npx @convex-dev/static-hosting deploy";
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  success("Added deploy script to package.json");
  return true;
}

function main(): void {
  console.log("\n🚀 Convex Static Hosting Setup\n");

  if (!existsSync("convex")) {
    mkdirSync("convex");
    success("Created convex/ directory");
  }

  const { needsStaticRoutes, requiresManualConfig } = createConvexConfig();
  const hasStaticDeployScript = updatePackageJson();

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
  if (requiresManualConfig) {
    console.log(
      "Before deploying, complete the configuration and routing checks printed above.\n",
    );
  }
  console.log("Next steps:\n");
  console.log("  1. npx convex dev          # Generate types");
  console.log(
    hasStaticDeployScript
      ? "  2. npm run deploy          # Build and deploy\n"
      : "  2. npx @convex-dev/static-hosting deploy  # Build and deploy\n",
  );
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
  console.log(
    "If app.use uses a custom name, replace components.staticHosting with that generated property.\n",
  );
}

main();
