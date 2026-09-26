// TanStack Start server entry for Convex HTTP actions. Nothing here is
// specific to this example, so it could become its own package. Keep it
// self-contained: import only TanStack and React, never app code.
// `src/server.ts` re-exports it as the entry Vite builds.

import { createStartHandler, StartServer } from "@tanstack/react-start/server";
import { renderSsrHtmlResponse } from "@tanstack/react-router/ssr/server";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

// Convex omits size, which TanStack uses when normalizing query-string URLs.
if (new URLSearchParams().size === undefined) {
  Object.defineProperty(URLSearchParams.prototype, "size", {
    configurable: true,
    get(this: URLSearchParams) {
      return Array.from(this).length;
    },
  });
}

export default {
  fetch: createStartHandler((context) => {
    const { router, responseHeaders, request } = context;
    return renderSsrHtmlResponse({
      router,
      responseHeaders,
      render: async () => {
        // Await Suspense with React's Web Stream renderer. TanStack's stream
        // handler also imports node:stream, which Convex cannot bundle.
        const stream = await renderToReadableStream(
          createElement(StartServer, { router }),
          {
            signal: request.signal,
            ...(router.options.ssr?.nonce === undefined
              ? {}
              : { nonce: router.options.ssr.nonce }),
          },
        );
        await stream.allReady;
        const html = await new Response(stream).text();
        // React emits a doctype; TanStack's HTML helper adds its own.
        return html.replace(/^<!DOCTYPE html>/i, "");
      },
    });
  }),
};
