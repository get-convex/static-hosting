// Vite settings that let TanStack Start's server build run in Convex HTTP
// actions. Like `server.ts`, this is not specific to the example and could
// move to its own package together with it.

import type { Plugin } from "vite";

export function convexSsr(): Plugin {
  return {
    name: "convex-tanstack-start",
    apply: "build",
    config: () => ({
      ssr: {
        noExternal: true,
        resolve: { conditions: ["worker", "browser", "module", "import"] },
      },
      resolve: {
        alias: [
          { find: /^react-dom\/server$/, replacement: "react-dom/server.edge" },
        ],
      },
    }),
  };
}
