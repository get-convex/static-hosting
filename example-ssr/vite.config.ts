import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { convexSsr } from "./adapter/vite.js";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    convexSsr(),
    tanstackStart({ prerender: { enabled: false } }),
    react(),
  ],
});
