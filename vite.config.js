import { defineConfig } from "vite";

// root = repo root so /fixtures/** and /schema/** are fetchable in dev and index.html lives here.
export default defineConfig({
  root: ".",
});
