import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    assetsDir: "assets",
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
