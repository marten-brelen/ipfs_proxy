import type { NextRequest } from "next/server";
import mime from "mime-types";

export const runtime = "nodejs"; // Ensure Node runtime on Vercel

const DEFAULT_GROVE_GATEWAY = process.env.DEFAULT_GROVE_GATEWAY || "https://api.grove.storage";

function pickGateway(url: URL) {
  const gw = url.searchParams.get("gateway");
  if (!gw) return DEFAULT_GROVE_GATEWAY;
  try {
    const u = new URL(gw);
    if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
  } catch {}
  return DEFAULT_GROVE_GATEWAY;
}

function normalizeGroveResource(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("lens://")) return trimmed.replace(/^lens:\/\//, "");
  if (trimmed.startsWith("grove://")) return trimmed.replace(/^grove:\/\//, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      return u.pathname.replace(/^\/+/, "");
    } catch {
      return "";
    }
  }
  return trimmed.replace(/^\/+/, "");
}

function inferFilename(slug: string[], reqUrl: URL) {
  const q = reqUrl.searchParams.get("filename");
  if (q) return q;
  const last = slug[slug.length - 1] ?? "";
  if (/\.[A-Za-z0-9]+$/.test(last)) return last;
  return "file";
}

function inferContentType(filename: string, fallback?: string) {
  return (mime.lookup(filename) || fallback || "application/octet-stream").toString();
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

async function handler(req: NextRequest, ctx: { params: Promise<{ slug?: string[] }> }) {
  const reqUrl = new URL(req.url);
  const params = await ctx.params;
  const slug = params.slug ?? [];
  const uriParam = reqUrl.searchParams.get("uri");

  const rawInput = uriParam ?? slug.join("/");
  if (!rawInput) {
    return new Response("Usage: /grove/<resourceId> or /grove?uri=lens://<resourceId>", { status: 400 });
  }

  const resourcePath = normalizeGroveResource(safeDecode(rawInput));
  if (!resourcePath) {
    return new Response("Invalid Grove resource.", { status: 400 });
  }

  const gateway = pickGateway(reqUrl);
  const normalizedPath = resourcePath.replace(/^file\//, "");
  const tryPaths = resourcePath.startsWith("file/")
    ? [normalizedPath, resourcePath]
    : [resourcePath, `file/${resourcePath}`];

  const fwdHeaders = new Headers();
  for (const h of ["range", "if-none-match", "if-modified-since", "accept"]) {
    const v = req.headers.get(h);
    if (v) fwdHeaders.set(h, v);
  }

  for (let i = 0; i < tryPaths.length; i += 1) {
    const upstreamUrl = `${gateway.replace(/\/+$/, "")}/${tryPaths[i]}`;
    const upstreamResp = await fetch(upstreamUrl, {
      method: req.method as "GET" | "HEAD",
      headers: fwdHeaders,
    });

    if (!upstreamResp.ok && upstreamResp.status !== 206) {
      if (upstreamResp.status === 404 && i < tryPaths.length - 1) {
        continue;
      }
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
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }

    return new Response(req.method === "HEAD" ? null : upstreamResp.body, {
      status: upstreamResp.status,
      headers,
    });
  }

  return new Response("Grove resource not found.", { status: 404 });
}

export const GET = handler;
export const HEAD = handler;
