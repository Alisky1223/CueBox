import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained HTML so the build runs from file:// with no server.
export default defineConfig({
  plugins: [viteSingleFile()],
  test: {
    include: ["tests/**/*.test.js"],
  },
});
