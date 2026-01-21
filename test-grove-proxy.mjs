const defaultLensUri = "lens://74bb5d787aa0e6b821292e0f2011ed22d06fccfa1864f6f5f4d6e9732a6a929f";

const lensUri = process.argv[2] || defaultLensUri;
const base = (process.argv[3] || process.env.IPFS_PROXY_BASE || "http://localhost:3000").replace(/\/+$/, "");
const filename = process.argv[4] || "";

const proxyUrl =
  `${base}/grove?uri=${encodeURIComponent(lensUri)}` +
  (filename ? `&filename=${encodeURIComponent(filename)}` : "");

async function run() {
  console.log("Lens URI:", lensUri);
  console.log("Proxy base:", base);
  console.log("Proxy URL:", proxyUrl);

  try {
    const res = await fetch(proxyUrl, { method: "HEAD" });
    console.log("Status:", res.status, res.statusText);
    console.log("Content-Type:", res.headers.get("content-type"));
    console.log("Content-Length:", res.headers.get("content-length"));
  } catch (err) {
    console.error("Request failed:", err?.message || err);
    process.exitCode = 1;
  }
}

run();
