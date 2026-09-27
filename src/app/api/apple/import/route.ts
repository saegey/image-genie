import { NextRequest, NextResponse } from "next/server";
import { importAppleAsset } from "@/lib/import-apple";

export const runtime = "nodejs";
export const maxDuration = 1800;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameLocalOrigin = false;
  try {
    if (origin && host) {
      const url = new URL(origin);
      sameLocalOrigin = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.host === host;
    }
  } catch { /* Invalid Origin. */ }
  if (!sameLocalOrigin) {
    return NextResponse.json({ error: "Import must be confirmed in Image Genie on this Mac." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { id, confirmed } = body as Record<string, unknown>;
  if (confirmed !== true || typeof id !== "string" || !id || id.length > 300 || /[\x00-\x1f]/.test(id)) {
    return NextResponse.json({ error: "Select and confirm a valid Apple Photos asset." }, { status: 400 });
  }
  try {
    return NextResponse.json(await importAppleAsset(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 502 });
  }
}
