import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

const app = defineApp();
app.use(staticHosting);

export default app;
