# Static Hosting Example

This example demonstrates how to use the `@convex-dev/static-hosting` component to host a React/Vite app directly on Convex.

## Running the Example

From the root of the repository:

```bash
# Install dependencies and start dev server
npm install
npm run dev
```

This starts:
- The Convex backend development server
- The Vite frontend development server
- A file watcher for rebuilding the component

## Deploying Static Files

Once you have a Convex deployment, build and upload the static files with the
CLI (it builds with the right `VITE_CONVEX_URL`, deploys the backend, and
uploads `dist/`):

```bash
# From the repo root
npm run deploy:static
```

Your app will then be available at `https://your-deployment.convex.site`.

## Files

- `convex/convex.config.ts` - Imports and uses the static hosting component
- `convex/staticHosting.ts` - Exposes the deployment query for `<UpdateBanner />`
- `src/` - Example React application

## How It Works

1. The component stores static files in its own Convex file storage
2. The component's HTTP routes serve files with proper Content-Type and caching
3. SPA fallback ensures client-side routing works correctly
4. Each deployment gets a unique ID for atomic updates and garbage collection
