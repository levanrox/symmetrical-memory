const http = require("http");
const fs = require("fs");
const path = require("path");

// Load .env.local first so PGRST_SERVER_PORT here matches the port PostgREST
// binds in docker-compose.yml. Values already in the environment win.
function loadEnvLocal() {
  try {
    const file = path.resolve(process.cwd(), ".env.local");
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}
loadEnvLocal();

// PostgREST binds PGRST_SERVER_PORT (default 54323, not the usual 54322, which
// commonly collides with other local tooling).
const TARGET_PORT = Number(process.env.PGRST_SERVER_PORT) || 54323;
// This gateway is what the app points NEXT_PUBLIC_SUPABASE_URL at.
const PROXY_PORT = Number(process.env.POSTGREST_GATEWAY_PORT) || 54321;

const server = http.createServer((req, res) => {
  let targetPath = req.url;
  if (targetPath.startsWith("/rest/v1")) {
    targetPath = targetPath.slice("/rest/v1".length);
  }
  if (!targetPath || targetPath === "") {
    targetPath = "/";
  }

  const headers = { ...req.headers };
  // Ensure host header points to target
  headers.host = `127.0.0.1:${TARGET_PORT}`;

  const options = {
    hostname: "127.0.0.1",
    port: TARGET_PORT,
    path: targetPath,
    method: req.method,
    headers: headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`PostgREST gateway listening on 127.0.0.1:${PROXY_PORT} -> forwarding to port ${TARGET_PORT}`);
});
