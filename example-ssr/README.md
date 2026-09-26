# TanStack Start SSR example

Renders TanStack Start pages inside a Convex HTTP action. The first HTML
response already contains a count from a Convex query, and after React hydrates,
the count stays live.

## How it works

- `convex/http.ts` has one catch-all route. It serves uploaded files with
  `serveStaticAsset`, returns 404 for missing `/assets/` files, and renders
  every other path with the TanStack Start server bundle.
- `src/router.tsx` sets up Convex's TanStack Query integration, so data from
  `useSuspenseQuery(convexQuery(...))` is in the first HTML and stays live.
- `adapter/` makes TanStack Start run in the Convex runtime. The comments in
  `server.ts` and `vite.ts` explain each setting. It doesn't depend on the
  example, so it could become its own package.
- `public/index.html` exists only because the uploader requires an `index.html`.

## Run

This example has its own schema, so use a separate Convex project. From the
repository root:

```bash
npm install
cd example-ssr
npm run dev
```

The first run asks you to choose a Convex project. `npm run dev` then keeps the
dev deployment in sync: each change rebuilds the page bundles, pushes the
backend, and uploads the browser files. Open the `.convex.site` URL it prints.
The page source contains the count and the render time. Open the page in two
tabs: a click in one updates both.

Backend pushes and file uploads are separate steps, so right after a change a
page can briefly refer to scripts that are not uploaded yet. Both bundles
contain the deployment URL, so rebuild before pushing to another deployment.
