import type { NextRequest } from "next/server";
import mime from "mime-types";

export const runtime = "nodejs"; // Ensure Node runtime on Vercel

const DEFAULT_GATEWAY = process.env.DEFAULT_GATEWAY || "https://cloudflare-ipfs.com";

function isCidLike(s: string) {
  // CIDv0 (Qm...) or CIDv1 (bafy...)
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/.test(s) || /^bafy[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s);
}

function pickGateway(url: URL) {
  const gw = url.searchParams.get("gateway");
  if (!gw) return DEFAULT_GATEWAY;
  try {
    const u = new URL(gw);
    if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
  } catch {}
  return DEFAULT_GATEWAY;
}

function inferFilename(slug: string[], reqUrl: URL) {
  const q = reqUrl.searchParams.get("filename");
  if (q) return q;
  const last = slug[slug.length - 1] ?? "";
  if (/\.[A-Za-z0-9]+$/.test(last)) return last;
  return "file"; // fallback; you can force .pptx via ?filename=mydeck.pptx
}

function inferContentType(filename: string, fallback?: string) {
  return (mime.lookup(filename) || fallback || "application/octet-stream").toString();
}

async function handler(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const reqUrl = new URL(req.url);
  const params = await ctx.params;
  const slug = params.slug ?? [];
  if (slug.length === 0) {
    return new Response("Usage: /api/ipfs/<CID>[/path/to/file]?filename=yourfile.pptx", { status: 400 });
  }

  const [cid, ...rest] = slug;
  if (!isCidLike(cid)) {
    return new Response("Invalid or missing CID.", { status: 400 });
  }

  const gateway = pickGateway(reqUrl);
  const upstreamUrl = `${gateway}/ipfs/${cid}${rest.length ? "/" + rest.join("/") : ""}`;

  // Forward important headers (Range, cache validators)
  const fwdHeaders = new Headers();
  for (const h of ["range", "if-none-match", "if-modified-since", "accept"]) {
    const v = req.headers.get(h);
    if (v) fwdHeaders.set(h, v);
  }

  const upstreamResp = await fetch(upstreamUrl, {
    method: req.method as "GET" | "HEAD",
    headers: fwdHeaders,
  });

  if (!upstreamResp.ok && upstreamResp.status !== 206) {
    return new Response(await upstreamResp.text(), {
      status: upstreamResp.status,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const filename = inferFilename(slug, reqUrl);
  const upstreamCT = upstreamResp.headers.get("content-type") ?? undefined;
  const contentType = upstreamCT && upstreamCT !== "application/octet-stream"
    ? upstreamCT
    : inferContentType(filename, upstreamCT);

  const headers = new Headers(upstreamResp.headers);
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `inline; filename="${filename}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Accept-Ranges, ETag");

  if (!headers.has("Cache-Control")) {
    // Safe because CIDs are immutable; adjust if you point at IPFS later
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  return new Response(req.method === "HEAD" ? null : upstreamResp.body, {
    status: upstreamResp.status,
    headers,
  });
}

export const GET = handler;
export const HEAD = handler;
