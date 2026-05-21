#!/usr/bin/env node
/**
 * One-shot deployment command that deploys both Convex backend and static files.
 *
 * Usage:
 *   npx @convex-dev/static-hosting deploy [options]
 *
 * This command:
 * 1. Builds the frontend with the correct VITE_CONVEX_URL
 * 2. Deploys the Convex backend (npx convex deploy)
 * 3. Deploys static files to Convex storage
 *
 * The goal is to minimize the inconsistency window between backend and frontend.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import {
  runConvex,
  spawnConvex,
  spawnShell,
  spawnStaticHostingCli,
} from "./commands.js";

interface ParsedArgs {
  dist: string;
  component: string;
  help: boolean;
  skipBuild: boolean;
  skipConvex: boolean;
  cdn: boolean;
  buildCommand: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    dist: "./dist",
    component: "staticHosting",
    help: false,
    skipBuild: false,
    skipConvex: false,
    cdn: false,
    buildCommand: "npm run build",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--dist" || arg === "-d") {
      result.dist = args[++i] || result.dist;
    } else if (arg === "--component" || arg === "-c") {
      result.component = args[++i] || result.component;
    } else if (arg === "--skip-build") {
      result.skipBuild = true;
    } else if (arg === "--skip-convex") {
      result.skipConvex = true;
    } else if (arg === "--cdn") {
      result.cdn = true;
    } else if (arg === "--build-command") {
      const cmd = args[++i];
      if (cmd) result.buildCommand = cmd;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Usage: npx @convex-dev/static-hosting deploy [options]

One-shot deployment: builds frontend, deploys Convex backend, then deploys static files.
Minimizes the inconsistency window between backend and frontend updates.

Options:
  -d, --dist <path>           Path to dist directory (default: ./dist)
  -c, --component <module>    Module name where upload API is exposed — i.e.
                              convex/<module>.ts (default: staticHosting). Not
                              the registered component name from convex.config.ts.
      --skip-build            Skip the build step (use existing dist)
      --skip-convex           Skip Convex backend deployment
      --build-command <cmd>   Build command to run (default: 'npm run build')
      --cdn                   Upload non-HTML assets to convex-fs CDN
  -h, --help                  Show this help message

Deployment Flow:
  1. Build frontend with production VITE_CONVEX_URL
  2. Deploy Convex backend (npx convex deploy)
  3. Deploy static files to Convex storage

Examples:
  # Full deployment
  npx @convex-dev/static-hosting deploy

  # Skip build (if already built)
  npx @convex-dev/static-hosting deploy --skip-build

  # Only deploy static files (skip Convex backend)
  npx @convex-dev/static-hosting deploy --skip-convex
`);
}

interface DeploymentUrls {
  siteUrl: string;
  cloudUrl: string;
}

/**
 * Resolve the component's deployment URLs (siteUrl + cloudUrl). Returns null
 * if the component isn't reachable yet — on first deploy the backend may not
 * exist, in which case the caller should deploy it first and retry.
 */
function tryFetchUrls(componentName: string): DeploymentUrls | null {
  try {
    const out = runConvex([
      "run",
      "--component",
      componentName,
      "lib:getUrls",
      "{}",
      "--prod",
      "--typecheck=disable",
      "--codegen=disable",
    ]);
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function fetchUrls(componentName: string): DeploymentUrls {
  const urls = tryFetchUrls(componentName);
  if (!urls) {
    console.error(
      `Could not reach component "${componentName}". Deploy the Convex backend first (npx convex deploy) and ensure --component matches the name in convex.config.ts.`,
    );
    process.exit(1);
  }
  return urls;
}

function getConvexProdSiteUrl(): string | null {
  try {
    return runConvex(["env", "get", "CONVEX_SITE_URL", "--prod"]) || null;
  } catch {
    return null;
  }
}

/**
 * Run the Convex storage upload flow
 */
async function uploadToConvexStorage(
  distDir: string,
  componentName: string,
  useCdn: boolean,
): Promise<boolean> {
  console.log("");
  console.log(
    useCdn
      ? "📦 Uploading static files (HTML to Convex, assets to CDN)..."
      : "📦 Uploading static files to Convex storage...",
  );
  console.log("");

  const uploadArgs = [
    "upload",
    "--dist",
    distDir,
    "--component",
    componentName,
    "--prod",
  ];

  if (useCdn) {
    uploadArgs.push("--cdn");
  }

  const result = spawnStaticHostingCli(uploadArgs);

  return result === 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  console.log("");
  console.log("🚀 Convex + Static Files Deployment");
  console.log("═══════════════════════════════════════════════════════════");

  const startTime = Date.now();

  // Step 1: Get deployment URLs (needed for build)
  console.log("");
  console.log("Step 1: Getting deployment URLs...");

  let urls = tryFetchUrls(args.component);

  if (!urls && !args.skipConvex) {
    console.log(
      "   Component not yet deployed. Will fetch URLs after deploying backend.",
    );
  } else if (urls) {
    console.log(`   ✓ ${urls.siteUrl}`);
  }

  // Step 2: Build frontend
  if (!args.skipBuild) {
    console.log("");
    console.log("Step 2: Building frontend...");

    // If the component isn't deployed yet, deploy the backend first so we
    // can ask it for the URLs.
    if (!urls && !args.skipConvex) {
      console.log("   Deploying Convex backend first to get URLs...");
      console.log("");

      const convexResult = spawnConvex(["deploy"]);

      if (convexResult !== 0) {
        console.error("");
        console.error("❌ Convex deployment failed");
        process.exit(1);
      }

      urls = fetchUrls(args.component);
      console.log("");
      console.log(`   ✓ Site URL: ${urls.siteUrl}`);
      args.skipConvex = true; // Already deployed
    }

    if (!urls) {
      console.error("");
      console.error("❌ Could not determine deployment URLs for build");
      console.error("   Run 'npx convex deploy' first or remove --skip-convex");
      process.exit(1);
    }

    const basePath = new URL(urls.siteUrl).pathname || "/";

    console.log(`   Build command: ${args.buildCommand}`);
    console.log(`   VITE_CONVEX_URL=${urls.cloudUrl}`);
    console.log(`   STATIC_HOSTING_BASE_PATH=${basePath}`);
    console.log("");

    const buildResult = spawnShell(args.buildCommand, {
      ...process.env,
      VITE_CONVEX_URL: urls.cloudUrl,
      STATIC_HOSTING_BASE_PATH: basePath,
    });

    if (buildResult !== 0) {
      console.error("");
      console.error("❌ Build failed");
      process.exit(1);
    }

    console.log("");
    console.log("   ✓ Build complete");
  } else {
    console.log("");
    console.log("Step 2: Skipping build (--skip-build)");
  }

  // Step 3: Deploy Convex backend
  if (!args.skipConvex) {
    console.log("");
    console.log("Step 3: Deploying Convex backend...");
    console.log("");

    const convexResult = spawnConvex(["deploy"]);

    if (convexResult !== 0) {
      console.error("");
      console.error("❌ Convex deployment failed");
      process.exit(1);
    }

    console.log("");
    console.log("   ✓ Convex backend deployed");
  } else {
    console.log("");
    console.log(
      "Step 3: Skipping Convex deployment (--skip-convex or already deployed)",
    );
  }

  // Step 4: Deploy static files
  console.log("");
  console.log("Step 4: Deploying static files to Convex storage...");

  const distDir = resolve(args.dist);

  if (!existsSync(distDir)) {
    console.error("");
    console.error(`❌ Dist directory not found: ${distDir}`);
    console.error("   Run build first or check --dist path");
    process.exit(1);
  }

  const staticDeploySuccess = await uploadToConvexStorage(
    distDir,
    args.component,
    args.cdn,
  );

  if (!staticDeploySuccess) {
    console.error("");
    console.error("❌ Static file upload failed");
    process.exit(1);
  }

  // Done!
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`✨ Deployment complete! (${duration}s)`);
  console.log("");

  const finalUrls = urls ?? fetchUrls(args.component);
  console.log(`Frontend: ${finalUrls.siteUrl}`);

  console.log("");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
