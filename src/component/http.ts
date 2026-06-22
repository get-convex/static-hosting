import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

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

export function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export function hasFileExtension(path: string): boolean {
  const lastSegment = path.split("/").pop() || "";
  return lastSegment.includes(".") && !lastSegment.startsWith(".");
}

// Vite hashed asset suffix: e.g. `index-lj_vq_aF.js`, `style-B71cUw87.css`
export function isHashedAsset(path: string): boolean {
  return /[-.][\dA-Za-z_]{6,12}\.[a-z]+$/.test(path);
}

function isHtmlContentType(contentType: string): boolean {
  return contentType.startsWith("text/html");
}

// SPA fallback (serving /index.html for extension-less paths that don't match
// a file) is on by default. Bind the STATIC_HOSTING_SPA_FALLBACK env var to
// "disabled" to turn it off and return 404s instead — useful for multi-page
// apps where unknown paths should be misses.
//   app.use(staticHosting, { env: { STATIC_HOSTING_SPA_FALLBACK: "disabled" } })
export function isSpaFallbackEnabled(): boolean {
  return env.STATIC_HOSTING_SPA_FALLBACK?.trim().toLowerCase() !== "disabled";
}

export function cacheControlFor(path: string): string {
  return isHashedAsset(path)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

function getSetupHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Convex Static Hosting</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 640px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fafafa;
      color: #333;
      line-height: 1.6;
    }
    h1 { color: #111; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 32px; }
    code {
      background: #e8e8e8;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 14px;
    }
    pre {
      background: #1a1a1a;
      color: #f0f0f0;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 14px;
    }
    .step { margin-bottom: 24px; }
    .step-num {
      display: inline-block;
      background: #333;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      text-align: center;
      font-size: 14px;
      line-height: 24px;
      margin-right: 8px;
    }
    a { color: #0070f3; }
  </style>
</head>
<body>
  <h1>Almost there!</h1>
  <p class="subtitle">Your Convex backend is running, but no static files have been deployed yet.</p>

  <div class="step">
    <span class="step-num">1</span>
    <strong>Build your frontend</strong>
    <pre>npm run build</pre>
  </div>

  <div class="step">
    <span class="step-num">2</span>
    <strong>Deploy your static files</strong>
    <pre>npx @convex-dev/static-hosting deploy</pre>
  </div>

  <p>Or deploy everything in one command:</p>
  <pre>npm run deploy</pre>

  <p style="margin-top: 32px; color: #666; font-size: 14px;">
    Learn more at <a href="https://github.com/get-convex/static-hosting">github.com/get-convex/static-hosting</a>
  </p>
</body>
</html>`;
}

// CONVEX_SITE_URL reflects the component's mount point (including any httpPrefix).
// We use it to strip the prefix from incoming request paths so lookups in
// the asset table remain relative to the component (e.g. `/index.html`).
export function getMountPrefix(): string {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) return "";
  try {
    const pathname = new URL(siteUrl).pathname;
    return pathname === "/" ? "" : pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

const serveStaticFile = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  let path = url.pathname;

  const mountPrefix = getMountPrefix();
  if (mountPrefix && path.startsWith(mountPrefix)) {
    path = path.slice(mountPrefix.length) || "/";
  }

  if (path === "" || path === "/") {
    path = "/index.html";
  }

  let asset = await ctx.runQuery(internal.lib.getByPath, { path });

  if (!asset && isSpaFallbackEnabled() && !hasFileExtension(path)) {
    asset = await ctx.runQuery(internal.lib.getByPath, { path: "/index.html" });
  }

  if (!asset) {
    if (path === "/index.html") {
      return new Response(getSetupHtml(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const contentType = asset.contentType || getMimeType(path);

  // CDN redirect: blobs are served by the platform at /fs/blobs/{id}, which
  // lives at the deployment root (not under the component's prefix).
  if (asset.blobId && !isHtmlContentType(contentType)) {
    const redirectUrl = `${url.origin}/fs/blobs/${asset.blobId}`;
    const cacheControl = cacheControlFor(path);
    return new Response(null, {
      status: 302,
      headers: { Location: redirectUrl, "Cache-Control": cacheControl },
    });
  }

  if (!asset.storageId) {
    return new Response("Asset not available", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const etag = `"${asset.storageId}"`;
  const ifNoneMatch = request.headers.get("If-None-Match");
  const cacheControl = cacheControlFor(path);

  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const blob = await ctx.storage.get(asset.storageId);
  if (!blob) {
    return new Response("Storage error", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

const http = httpRouter();

http.route({
  pathPrefix: "/",
  method: "GET",
  handler: serveStaticFile,
});

export default http;
