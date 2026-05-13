import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  envDir: "../",
  base: process.env.STATIC_HOSTING_BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    conditions: ["@convex-dev/component-source"],
  },
});
