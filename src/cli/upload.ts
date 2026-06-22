#!/usr/bin/env node
/**
 * CLI tool to upload static files to a Convex static-hosting component.
 *
 * Usage:
 *   npx @convex-dev/static-hosting upload [options]
 *
 * Options:
 *   --dist <path>            Path to dist directory (default: ./dist)
 *   --component <name>       Component instance name (default: staticHosting)
 *   --prod                   Deploy to production deployment
 *   --help                   Show help
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative, extname, resolve } from "path";
import { randomUUID } from "crypto";
import { runConvexAsync, spawnShell } from "./commands.js";

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
};

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

interface ParsedArgs {
  dist: string;
  component: string;
  prod: boolean;
  build: boolean;
  buildCommand: string;
  cdn: boolean;
  cdnDeleteFunction: string;
  concurrency: number;
  spaFallback: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    dist: "./dist",
    component: "staticHosting",
    prod: false, // Default to dev, use --prod for production
    build: false,
    buildCommand: "npm run build",
    cdn: false,
    cdnDeleteFunction: "",
    concurrency: 5,
    spaFallback: true,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--dist" || arg === "-d") {
      result.dist = args[++i] || result.dist;
    } else if (arg === "--component" || arg === "-c") {
      result.component = args[++i] || result.component;
    } else if (arg === "--prod") {
      result.prod = true;
    } else if (arg === "--no-prod" || arg === "--dev") {
      result.prod = false;
    } else if (arg === "--build" || arg === "-b") {
      result.build = true;
    } else if (arg === "--build-command") {
      const cmd = args[++i];
      if (cmd) {
        result.buildCommand = cmd;
        result.build = true;
      }
    } else if (arg === "--no-spa") {
      result.spaFallback = false;
    } else if (arg === "--spa") {
      result.spaFallback = true;
    } else if (arg === "--cdn") {
      result.cdn = true;
    } else if (arg === "--cdn-delete-function") {
      result.cdnDeleteFunction = args[++i] || result.cdnDeleteFunction;
    } else if (arg === "--concurrency" || arg === "-j") {
      const val = parseInt(args[++i], 10);
      if (val > 0) result.concurrency = val;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Usage: npx @convex-dev/static-hosting upload [options]

Upload static files from a dist directory to Convex storage.

Options:
  -d, --dist <path>           Path to dist directory (default: ./dist)
  -c, --component <name>      Static-hosting component instance name (default: staticHosting)
      --prod                  Deploy to production deployment
  -b, --build                 Run the build command with VITE_CONVEX_URL +
                              STATIC_HOSTING_BASE_PATH set before uploading
      --build-command <cmd>   Build command to run (default: 'npm run build').
                              Implies --build.
      --no-spa                Disable SPA fallback for this deployment (extension-less
                              misses return 404 instead of index.html)
      --cdn                   Upload non-HTML assets to convex-fs CDN instead of Convex storage
      --cdn-delete-function <name>  App function to delete CDN blobs (e.g. staticHosting:deleteCdnBlobs)
  -j, --concurrency <n>       Number of parallel uploads (default: 5)
  -h, --help                  Show this help message

Examples:
  # Upload to Convex storage
  npx @convex-dev/static-hosting upload
  npx @convex-dev/static-hosting upload --dist ./build --prod
  npx @convex-dev/static-hosting upload --build --prod

  # Upload with CDN (non-HTML files served from CDN)
  npx @convex-dev/static-hosting upload --cdn --prod
`);
}

// Global flag for production mode
let useProd = true;

interface DeploymentUrls {
  /** CONVEX_SITE_URL — includes the component's mount prefix. */
  siteUrl: string;
  /** CONVEX_CLOUD_URL — backend URL the frontend connects to. */
  cloudUrl: string;
}

/**
 * Resolve the component's deployment URLs. Bails the CLI if the component
 * isn't deployed — uploading wouldn't work either, so a fallback would only
 * hide the real problem.
 */
async function fetchUrls(componentName: string): Promise<DeploymentUrls> {
  try {
    const out = await convexRunAsync(componentName, "lib:getUrls");
    return JSON.parse(out);
  } catch {
    console.error(
      `Could not reach component "${componentName}". Deploy the Convex backend first and ensure --component matches the name in convex.config.ts.`,
    );
    process.exit(1);
  }
}

function convexRunAsync(
  componentName: string | undefined,
  functionPath: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return runConvexAsync([
    "run",
    ...(componentName ? ["--component", componentName] : []),
    functionPath,
    JSON.stringify(args),
    "--typecheck=disable",
    "--codegen=disable",
    ...(useProd ? ["--prod"] : []),
  ]);
}

async function uploadWithConcurrency(
  files: Array<{ path: string; localPath: string; contentType: string }>,
  componentName: string,
  deploymentId: string,
  useCdn: boolean,
  cdnUploadBase: string | null,
  concurrency: number,
): Promise<void> {
  const total = files.length;

  // Separate CDN and storage files
  const cdnFiles: typeof files = [];
  const storageFiles: typeof files = [];
  for (const file of files) {
    const isHtml = file.contentType.startsWith("text/html");
    if (useCdn && !isHtml && cdnUploadBase) {
      cdnFiles.push(file);
    } else {
      storageFiles.push(file);
    }
  }

  // Upload storage files using batch operations
  let completed = 0;
  const allAssets: Array<{
    path: string;
    storageId?: string;
    blobId?: string;
    contentType: string;
    deploymentId: string;
  }> = [];

  if (storageFiles.length > 0) {
    // Step 1: Generate all upload URLs in one batch call
    console.log(`  Generating ${storageFiles.length} upload URLs...`);
    const urlsOutput = await convexRunAsync(
      componentName,
      "lib:generateUploadUrls",
      { count: storageFiles.length },
    );
    const uploadUrls: string[] = JSON.parse(urlsOutput);

    // Step 2: Upload all files in parallel via fetch
    const storageIds: string[] = new Array(storageFiles.length);
    const pending = new Set<Promise<void>>();

    for (let i = 0; i < storageFiles.length; i++) {
      const idx = i;
      const file = storageFiles[idx];
      const task = (async () => {
        const content = readFileSync(file.localPath);
        const response = await fetch(uploadUrls[idx], {
          method: "POST",
          headers: { "Content-Type": file.contentType },
          body: content,
        });
        const { storageId } = (await response.json()) as { storageId: string };
        storageIds[idx] = storageId;
        completed++;
        const isHtml = file.contentType.startsWith("text/html");
        console.log(
          `  [${completed}/${total}] ${file.path} (${isHtml ? "storage/html" : "storage"})`,
        );
      })().then(() => {
        pending.delete(task);
      });
      pending.add(task);
      if (pending.size >= concurrency) {
        await Promise.race(pending);
      }
    }
    await Promise.all(pending);

    for (let i = 0; i < storageFiles.length; i++) {
      allAssets.push({
        path: storageFiles[i].path,
        storageId: storageIds[i],
        contentType: storageFiles[i].contentType,
        deploymentId,
      });
    }
  }

  // Upload CDN files (still uses per-file calls since CDN has its own upload endpoint)
  if (cdnFiles.length > 0 && cdnUploadBase) {
    const pending = new Set<Promise<void>>();
    for (const file of cdnFiles) {
      const task = (async () => {
        const content = readFileSync(file.localPath);
        const uploadResponse = await fetch(`${cdnUploadBase}/fs/upload`, {
          method: "POST",
          headers: { "Content-Type": file.contentType },
          body: content,
        });
        if (!uploadResponse.ok) {
          throw new Error(
            `CDN upload failed for ${file.path}: ${uploadResponse.status}`,
          );
        }
        const { blobId } = (await uploadResponse.json()) as { blobId: string };
        allAssets.push({
          path: file.path,
          blobId,
          contentType: file.contentType,
          deploymentId,
        });
        completed++;
        console.log(`  [${completed}/${total}] ${file.path} (cdn)`);
      })().then(() => {
        pending.delete(task);
      });
      pending.add(task);
      if (pending.size >= concurrency) {
        await Promise.race(pending);
      }
    }
    await Promise.all(pending);
  }

  // Step 3: Record all assets in one batch call
  if (allAssets.length > 0) {
    console.log("  Recording assets...");
    // recordAssets only handles storageId assets; CDN assets need individual recording
    const storageAssets = allAssets.filter((a) => a.storageId);
    const cdnAssets = allAssets.filter((a) => a.blobId);

    if (storageAssets.length > 0) {
      await convexRunAsync(componentName, "lib:recordAssets", {
        assets: storageAssets.map((a) => ({
          path: a.path,
          storageId: a.storageId!,
          contentType: a.contentType,
          deploymentId: a.deploymentId,
        })),
      });
    }

    // CDN assets still need individual recording (they use blobId not storageId)
    for (const asset of cdnAssets) {
      await convexRunAsync(componentName, "lib:recordAsset", {
        path: asset.path,
        blobId: asset.blobId,
        contentType: asset.contentType,
        deploymentId: asset.deploymentId,
      });
    }
  }
}

function collectFiles(
  dir: string,
  baseDir: string,
): Array<{ path: string; localPath: string; contentType: string }> {
  const files: Array<{
    path: string;
    localPath: string;
    contentType: string;
  }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push({
        path: "/" + relative(baseDir, fullPath).replace(/\\/g, "/"),
        localPath: fullPath,
        contentType: getMimeType(fullPath),
      });
    }
  }
  return files;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Set global prod flag
  useProd = args.prod;

  // The component knows both its CONVEX_SITE_URL (where the app is served,
  // including the mount prefix) and CONVEX_CLOUD_URL (what the frontend
  // connects to). We fetch both in one call and trust neither hostname.
  const { siteUrl: componentSiteUrl, cloudUrl: convexUrl } = await fetchUrls(
    args.component,
  );

  // Run build if requested
  if (args.build) {
    const basePath = new URL(componentSiteUrl).pathname || "/";

    const envLabel = useProd ? "production" : "development";
    console.log(`🔨 Building for ${envLabel}...`);
    console.log(`   Build command: ${args.buildCommand}`);
    console.log(`   VITE_CONVEX_URL=${convexUrl}`);
    console.log(`   STATIC_HOSTING_BASE_PATH=${basePath}`);
    console.log("");

    const buildResult = spawnShell(args.buildCommand, {
      ...process.env,
      VITE_CONVEX_URL: convexUrl,
      STATIC_HOSTING_BASE_PATH: basePath,
    });

    if (buildResult !== 0) {
      console.error("Build failed.");
      process.exit(1);
    }

    console.log("");
  }

  const distDir = resolve(args.dist);
  const componentName = args.component;
  const useCdn = args.cdn;

  // Convex storage deployment

  if (!existsSync(distDir)) {
    console.error(`Error: dist directory not found: ${distDir}`);
    console.error(
      "Run your build command first (e.g., 'npm run build' or add --build flag)",
    );
    process.exit(1);
  }

  // /fs/upload lives at the deployment root, not under the component's
  // mount prefix.
  const cdnUploadBase = useCdn ? new URL(componentSiteUrl).origin : null;

  const deploymentId = randomUUID();
  const files = collectFiles(distDir, distDir);

  const envLabel = useProd ? "production" : "development";
  console.log(`🚀 Deploying to ${envLabel} environment`);
  if (useCdn) {
    console.log("☁️  CDN mode: non-HTML assets will be uploaded to convex-fs");
  }
  console.log("🔒 Using secure internal functions (requires Convex CLI auth)");
  console.log(
    `Uploading ${files.length} files with deployment ID: ${deploymentId}`,
  );
  console.log(`Component: ${componentName}`);
  console.log("");

  try {
    await uploadWithConcurrency(
      files,
      componentName,
      deploymentId,
      useCdn,
      cdnUploadBase,
      args.concurrency,
    );
  } catch {
    console.error("Upload failed.");
    process.exit(1);
  }

  console.log("");

  // Garbage collect old files and record this deployment's SPA config.
  const gcOutput = await convexRunAsync(componentName, "lib:gcOldAssets", {
    currentDeploymentId: deploymentId,
    spaFallback: args.spaFallback,
  });
  const gcResult = JSON.parse(gcOutput);
  const deletedCount: number = gcResult.deleted;
  const oldBlobIds: string[] = gcResult.blobIds ?? [];

  if (deletedCount > 0) {
    console.log(
      `Cleaned up ${deletedCount} old storage file(s) from previous deployments`,
    );
  }

  // Clean up old CDN blobs if the app exposes a delete function. Component
  // actions can't reach the deployment-root /fs/blobs endpoint, so CDN GC
  // remains an opt-in app-level function.
  if (oldBlobIds.length > 0 && args.cdnDeleteFunction) {
    try {
      await convexRunAsync(undefined, args.cdnDeleteFunction, {
        blobIds: oldBlobIds,
      });
      console.log(
        `Cleaned up ${oldBlobIds.length} old CDN blob(s) from previous deployments`,
      );
    } catch {
      console.warn(
        `Warning: Could not delete old CDN blobs via ${args.cdnDeleteFunction}.`,
      );
    }
  } else if (oldBlobIds.length > 0) {
    console.log(
      `${oldBlobIds.length} old CDN blob(s) left in place. Pass --cdn-delete-function to clean them up.`,
    );
  }

  console.log("");
  console.log("✨ Upload complete!");

  console.log("");
  console.log(`Your app is now available at: ${componentSiteUrl}`);
}

main().catch((error) => {
  console.error("Upload failed:", error);
  process.exit(1);
});
