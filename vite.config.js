import { defineConfig } from "vite";
import { analyzePlugin } from "./server/analyze-plugin.js";

// root = repo root so /fixtures/** and /schema/** are fetchable in dev and index.html lives here.
export default defineConfig({
  root: ".",
  plugins: [analyzePlugin()],
});
