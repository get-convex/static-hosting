import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

const app = defineApp({ httpPrefix: "/api" });

app.use(staticHosting, { httpPrefix: "/" });

export default app;
