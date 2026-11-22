import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works at any URL (including GitHub Pages).
  base: "./",
  plugins: [react()],
  // The coaching logic in ../src is shared with the CLI.
  server: { fs: { allow: [".."] } },
});
