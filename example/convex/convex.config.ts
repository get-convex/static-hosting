import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({ httpPrefix: "/api" });

app.use(staticHosting, { httpPrefix: "/" });

export default app;
