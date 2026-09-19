// Vite dev-server plugin adding POST /api/analyze (docs/ROUND-3.md C): writes the uploaded
// files to a fresh dir under .layers-work/ (gitignored), runs bin/layers-analyze --bundle,
// returns the bundle JSON plus warnings (the analyzer's stderr lines), always cleans up.
// The request handler is exported separately from the plugin wrapper so it can be
// unit-tested with fake req/res (test/analyze-plugin.test.js).
import { execFile } from "node:child_process";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Returns { status, error } on a bad payload, null when valid.
function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: 400, error: "request body must be a JSON object" };
  }
  const { name, files, entry } = payload;
  if (typeof name !== "string" || !name.trim()) return { status: 400, error: "name is required" };
  if (!Array.isArray(files) || files.length === 0) return { status: 400, error: "files must be a non-empty array" };

  const seen = new Set();
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.text !== "string") {
      return { status: 400, error: "each file needs a path and text" };
    }
    if (path.isAbsolute(file.path)) return { status: 400, error: `path must be relative: ${file.path}` };
    if (file.path.split("/").includes("..")) return { status: 400, error: `path may not contain ..: ${file.path}` };
    if (file.path.includes("\\")) return { status: 400, error: `path may not contain backslashes: ${file.path}` };
    if (seen.has(file.path)) return { status: 400, error: `duplicate path: ${file.path}` };
    seen.add(file.path);
    totalBytes += Buffer.byteLength(file.text, "utf8");
  }

  if (entry !== null && entry !== undefined && typeof entry !== "string") {
    return { status: 400, error: "entry must be a string or null" };
  }
  if (entry && !seen.has(entry)) return { status: 400, error: `entry not found among files: ${entry}` };
  if (totalBytes > MAX_TOTAL_BYTES) return { status: 413, error: "upload too large (max 5 MB total)" };

  return null;
}

function runAnalyze(binPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(binPath, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.signal) {
          reject(Object.assign(new Error("analyze timed out"), { status: 504 }));
          return;
        }
        reject(Object.assign(new Error(stderr?.trim() || error.message), { status: 500 }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// opts: { repoRoot, binPath, workRoot, timeoutMs } — all optional, defaulted from repoRoot.
export function createAnalyzeHandler(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const binPath = opts.binPath ?? path.join(repoRoot, "bin/layers-analyze");
  const workRoot = opts.workRoot ?? path.join(repoRoot, ".layers-work");
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return async function analyzeHandler(req, res) {
    let bodyText;
    try {
      bodyText = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      sendJson(res, err.status ?? 400, { error: err.message });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      sendJson(res, 400, { error: "request body must be valid JSON" });
      return;
    }

    const invalid = validatePayload(payload);
    if (invalid) {
      sendJson(res, invalid.status, { error: invalid.error });
      return;
    }

    const id = randomBytes(8).toString("hex");
    const workDir = path.join(workRoot, id);
    const srcDir = path.join(workDir, "src");
    const bundlePath = path.join(workDir, "bundle.json");

    try {
      await mkdir(srcDir, { recursive: true });
      for (const file of payload.files) {
        const dest = path.join(srcDir, file.path);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, file.text, "utf8");
      }

      const args = [srcDir, "--root", srcDir, "--name", payload.name, "--bundle", bundlePath];
      if (payload.entry) args.push("--entry", payload.entry);

      const { stderr } = await runAnalyze(binPath, args, timeoutMs);
      const bundleJson = JSON.parse(await readFile(bundlePath, "utf8"));
      const warnings = stderr
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      sendJson(res, 200, { ...bundleJson, warnings });
    } catch (err) {
      sendJson(res, err.status ?? 500, { error: err.message });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };
}

export function analyzePlugin(opts = {}) {
  const handler = createAnalyzeHandler(opts);
  return {
    name: "layers-analyze",
    configureServer(server) {
      server.middlewares.use("/api/analyze", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        handler(req, res).catch((err) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err.message }));
        });
      });
    },
  };
}
