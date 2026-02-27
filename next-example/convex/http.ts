import { httpRouter } from "convex/server";
import { registerNextRoutes } from "@convex-dev/static-hosting/next";
import { components, internal } from "./_generated/api";

const http = httpRouter();

registerNextRoutes(http, components.staticHosting, internal._generatedNextServer.handle);

export default http;
