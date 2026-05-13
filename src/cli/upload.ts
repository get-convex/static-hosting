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
import { execSync, execFile, spawnSync } from "child_process";

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
  cdn: boolean;
  cdnDeleteFunction: string;
  concurrency: number;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    dist: "./dist",
    component: "staticHosting",
    prod: false, // Default to dev, use --prod for production
    build: false,
    cdn: false,
    cdnDeleteFunction: "",
    concurrency: 5,
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
  -b, --build                 Run 'npm run build' with correct VITE_CONVEX_URL before uploading
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

function convexRunComponentAsync(
  componentName: string,
  functionPath: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return convexRunAsync(functionPath, args, componentName);
}

/**
 * Resolve the component's mount prefix from CONVEX_SITE_URL. Returns "/" if
 * the component isn't deployed yet or the query is unavailable.
 */
async function fetchBasePath(componentName: string): Promise<string> {
  try {
    const out = await convexRunComponentAsync(componentName, "lib:getBasePath");
    const value = JSON.parse(out);
    return typeof value === "string" && value.length > 0 ? value : "/";
  } catch {
    return "/";
  }
}

function convexRunAsync(
  functionPath: string,
  args: Record<string, unknown> = {},
  componentName?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdArgs = [
      "convex",
      "run",
      ...(componentName ? ["--component", componentName] : []),
      functionPath,
      JSON.stringify(args),
      "--typecheck=disable",
      "--codegen=disable",
    ];
    if (useProd) cmdArgs.push("--prod");
    execFile("npx", cmdArgs, { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error) {
        console.error("Convex run failed:", stderr || stdout);
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function uploadWithConcurrency(
  files: Array<{ path: string; localPath: string; contentType: string }>,
  componentName: string,
  deploymentId: string,
  useCdn: boolean,
  siteUrl: string | null,
  concurrency: number,
): Promise<void> {
  const total = files.length;

  // Separate CDN and storage files
  const cdnFiles: typeof files = [];
  const storageFiles: typeof files = [];
  for (const file of files) {
    const isHtml = file.contentType.startsWith("text/html");
    if (useCdn && !isHtml && siteUrl) {
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
    const urlsOutput = await convexRunComponentAsync(
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
        console.log(`  [${completed}/${total}] ${file.path} (${isHtml ? "storage/html" : "storage"})`);
      })().then(() => { pending.delete(task); });
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
  if (cdnFiles.length > 0 && siteUrl) {
    const pending = new Set<Promise<void>>();
    for (const file of cdnFiles) {
      const task = (async () => {
        const content = readFileSync(file.localPath);
        const uploadResponse = await fetch(`${siteUrl}/fs/upload`, {
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
      })().then(() => { pending.delete(task); });
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
      await convexRunComponentAsync(componentName, "lib:recordAssets", {
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
      await convexRunComponentAsync(componentName, "lib:recordAsset", {
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

  // Run build if requested
  if (args.build) {
    let convexUrl: string | null = null;

    if (useProd) {
      // Get production URL from convex dashboard
      try {
        const result = execSync("npx convex dashboard --prod --no-open", {
          stdio: "pipe",
          encoding: "utf-8",
        });
        const match = result.match(/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/i);
        if (match) {
          convexUrl = `https://${match[1]}.convex.cloud`;
        }
      } catch {
        console.error("Could not get production Convex URL.");
        console.error(
          "Make sure you have deployed to production: npx convex deploy",
        );
        process.exit(1);
      }
    } else {
      // Get dev URL from .env.local
      if (existsSync(".env.local")) {
        const envContent = readFileSync(".env.local", "utf-8");
        const match = envContent.match(/(?:VITE_)?CONVEX_URL=(.+)/);
        if (match) {
          convexUrl = match[1].trim();
        }
      }
    }

    if (!convexUrl) {
      console.error("Could not determine Convex URL for build.");
      process.exit(1);
    }

    const basePath = await fetchBasePath(args.component);

    const envLabel = useProd ? "production" : "development";
    console.log(`🔨 Building for ${envLabel}...`);
    console.log(`   VITE_CONVEX_URL=${convexUrl}`);
    console.log(`   STATIC_HOSTING_BASE_PATH=${basePath}`);
    console.log("");

    const buildResult = spawnSync("npm", ["run", "build"], {
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_CONVEX_URL: convexUrl,
        STATIC_HOSTING_BASE_PATH: basePath,
      },
    });

    if (buildResult.status !== 0) {
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

  // If CDN mode, we need the site URL for uploading to convex-fs
  let siteUrl: string | null = null;
  if (useCdn) {
    siteUrl = getConvexSiteUrl(useProd);
    if (!siteUrl) {
      console.error("Error: Could not determine Convex site URL for CDN uploads.");
      console.error("Make sure your Convex deployment is running.");
      process.exit(1);
    }
  }

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
      siteUrl,
      args.concurrency,
    );
  } catch {
    console.error("Upload failed.");
    process.exit(1);
  }

  console.log("");

  // Garbage collect old files
  const gcOutput = await convexRunComponentAsync(
    componentName,
    "lib:gcOldAssets",
    { currentDeploymentId: deploymentId },
  );
  const gcResult = JSON.parse(gcOutput);
  const deletedCount: number = gcResult.deleted;
  const oldBlobIds: string[] = gcResult.blobIds ?? [];

  if (deletedCount > 0) {
    console.log(`Cleaned up ${deletedCount} old storage file(s) from previous deployments`);
  }

  // Clean up old CDN blobs if the app exposes a delete function. Component
  // actions can't reach the deployment-root /fs/blobs endpoint, so CDN GC
  // remains an opt-in app-level function.
  if (oldBlobIds.length > 0 && args.cdnDeleteFunction) {
    try {
      await convexRunAsync(args.cdnDeleteFunction, { blobIds: oldBlobIds });
      console.log(`Cleaned up ${oldBlobIds.length} old CDN blob(s) from previous deployments`);
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

  // Show the deployment URL
  const deployedSiteUrl = getConvexSiteUrl(useProd);
  if (deployedSiteUrl) {
    console.log("");
    console.log(`Your app is now available at: ${deployedSiteUrl}`);
  }
}

/**
 * Get the Convex site URL (.convex.site) from the cloud URL
 */
function getConvexSiteUrl(prod: boolean): string | null {
  try {
    const envFlag = prod ? "--prod" : "";
    const result = execSync(`npx convex env get CONVEX_CLOUD_URL ${envFlag}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    const cloudUrl = result.trim();
    if (cloudUrl && cloudUrl.includes(".convex.cloud")) {
      return cloudUrl.replace(".convex.cloud", ".convex.site");
    }
  } catch {
    // Ignore errors
  }
  return null;
}

main().catch((error) => {
  console.error("Upload failed:", error);
  process.exit(1);
});
