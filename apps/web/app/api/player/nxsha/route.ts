import { NextRequest, NextResponse } from "next/server";
import { desktopSkip } from "../../desktop-skip";

export const dynamic = "force-static";
import crypto from "node:crypto";

/**
 * Server-side proxy for Nxsha's encrypted download-API.
 *
 * Nxsha exposes unauthenticated endpoints (/api/servers, /api/sources) whose
 * payload `q` is AES-256-CBC (OpenSSL EVP_BytesToKey, MD5, key‖iv) URL-safe
 * base64 with a `Salted__` prefix; responses are `{ _hash }` blobs in the same
 * scheme. The password is public client-bundle obfuscation, not a secret.
 *
 * Mobile cannot run this crypto in Hermes without a native module (which would
 * break OTA-only shipping), so the web backend does it here — mirroring the
 * existing `falix` proxy at app/api/player/falix/route.ts. Mobile just does a
 * plain fetch against this route; no crypto ships in the JS bundle.
 */

const NXSHA_WEB_BASE = "https://web.nxsha.app";
const NXSHA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const NXSHA_PROVIDER_DELAY_MS = 600;
const NXSHA_API_TIMEOUT_MS = 15000;
const NXSHA_API_KEY = Buffer.from([
  83, 56, 120, 33, 74, 107, 52, 90, 80, 49, 117, 71, 56, 36, 109, 121,
]);

/** OpenSSL EVP_BytesToKey (MD5, 1 iteration) → 48-byte key‖iv. */
function evpKdf(password: Buffer, salt: Buffer): Buffer {
  const data = Buffer.concat([password, salt]);
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let total = 0;
  while (total < 48) {
    prev = crypto
      .createHash("md5")
      .update(Buffer.concat([prev, data]))
      .digest();
    out.push(prev);
    total += prev.length;
  }
  return Buffer.concat(out);
}

function nxshaEncode(payload: Record<string, unknown>): string {
  const body = JSON.stringify({
    ...payload,
    _req_ts: Date.now(),
    _req_salt: crypto.randomBytes(8).toString("hex").slice(0, 10),
  });
  const salt = crypto.randomBytes(8);
  const keyiv = evpKdf(NXSHA_API_KEY, salt);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    keyiv.subarray(0, 32),
    keyiv.subarray(32),
  );
  return Buffer.concat([
    Buffer.from("Salted__"),
    salt,
    cipher.update(body, "utf8"),
    cipher.final(),
  ])
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function nxshaDecode(str: string): Record<string, unknown> | null {
  try {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const raw = Buffer.from(b64, "base64");
    if (raw.subarray(0, 8).toString() !== "Salted__") return null;
    const keyiv = evpKdf(NXSHA_API_KEY, raw.subarray(8, 16));
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      keyiv.subarray(0, 32),
      keyiv.subarray(32),
    );
    return JSON.parse(
      Buffer.concat([
        decipher.update(raw.subarray(16)),
        decipher.final(),
      ]).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface NxshaApiServer {
  name?: string;
  scraper?: string;
  id?: number | string;
  isDisable?: boolean;
  dl_support?: boolean;
  position?: number;
}
interface NxApiSource {
  url?: string;
  org_uri?: string;
  quality?: string;
  label?: string;
  provider?: string;
}

async function nxshaApiGet(
  path: string,
  qObj: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const q = encodeURIComponent(nxshaEncode(qObj));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NXSHA_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${NXSHA_WEB_BASE}${path}?q=${q}`, {
      headers: {
        "User-Agent": NXSHA_UA,
        Accept: "*/*",
        Referer: `${NXSHA_WEB_BASE}/dl/movie/1`,
      },
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { _hash?: string };
    const decoded = j && j._hash ? nxshaDecode(j._hash) : null;
    if (!decoded) throw new Error("decode failed");
    return decoded;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";
  const id = searchParams.get("id");
  const season = searchParams.get("season") ?? "1";
  const episode = searchParams.get("episode") ?? "1";

  if (!id) {
    return NextResponse.json(
      { error: "Missing required query parameter: id" },
      { status: 400 },
    );
  }

  try {
    const baseQ = {
      tmdbId: id,
      imdb_id: "",
      type,
      season,
      episode,
      method: "dl",
    };

    let srv: Record<string, unknown>;
    try {
      srv = await nxshaApiGet("/api/servers", baseQ);
    } catch {
      return NextResponse.json(
        { error: "Nxsha API unreachable" },
        { status: 502 },
      );
    }
    const apiServers = Array.isArray(srv.servers)
      ? (srv.servers as NxshaApiServer[])
      : [];
    const usable = apiServers.filter(
      (s) =>
        s &&
        s.isDisable !== true &&
        s.dl_support !== false &&
        (s.scraper || s.id != null),
    );
    if (usable.length === 0) {
      return NextResponse.json({ servers: [] }, { status: 200 });
    }

    usable.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

    const outServers: Array<{
      name: string;
      links: Array<{
        url: string;
        label: string;
        orgUri?: string;
        provider: string;
      }>;
    }> = [];

    for (const s of usable) {
      const provider = String(s.scraper || s.id);
      await new Promise((r) => setTimeout(r, NXSHA_PROVIDER_DELAY_MS));
      let src: Record<string, unknown> | null = null;
      try {
        src = await nxshaApiGet("/api/sources", { ...baseQ, provider });
      } catch {
        continue;
      }
      const list = Array.isArray(src.sources)
        ? (src.sources as NxApiSource[]).filter(Boolean)
        : [];
      if (list.length === 0) continue;
      outServers.push({
        name: String(s.name || provider),
        links: list.map((it) => ({
          url: String(it.url || it.org_uri || ""),
          label: String(it.label || it.quality || "").trim(),
          orgUri: it.org_uri ? String(it.org_uri) : undefined,
          provider,
        })),
      });
    }

    return NextResponse.json(
      { servers: outServers },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "Nxsha proxy failed" }, { status: 502 });
  }
}
