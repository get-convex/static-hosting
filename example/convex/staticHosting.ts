import { components } from "./_generated/api.js";
import { exposeDeploymentQuery } from "@convex-dev/static-hosting";

// Public query for live-reload notifications. Only needed if you use
// <UpdateBanner /> / useDeploymentUpdates from @convex-dev/static-hosting/react.
export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.staticHosting,
);
