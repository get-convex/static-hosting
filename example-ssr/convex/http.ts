import { httpRouter } from "convex/server";
import {
  decodeRequestPath,
  serveStaticAsset,
} from "@convex-dev/static-hosting";
import { components } from "./_generated/api.js";
import { httpAction } from "./_generated/server.js";

const http = httpRouter();

http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // Uploaded files first: scripts, styles, and everything in public/.
    const file = await serveStaticAsset(ctx, components.staticHosting, request);
    if (file) return file;

    // A missing script from another build must stay a 404, not a page. Don't
    // let a CDN cache it: the file may be uploaded a moment later.
    const path = decodeRequestPath(new URL(request.url).pathname);
    if (path === null || path.startsWith("/assets/")) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }

    // Every other path is a page. TanStack Start renders it, including its own
    // 404 page. Loading the renderer here keeps file requests fast. Copy the
    // headers, which may be immutable on this response.
    const { default: server } = await import("../dist/server/server.js");
    const rendered = await server.fetch(request);
    const headers = new Headers(rendered.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(rendered.body, {
      status: rendered.status,
      statusText: rendered.statusText,
      headers,
    });
  }),
});

export default http;
