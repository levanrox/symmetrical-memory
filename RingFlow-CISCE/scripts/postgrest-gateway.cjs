const http = require("http");

const TARGET_PORT = 54322;
const PROXY_PORT = 54321;

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
