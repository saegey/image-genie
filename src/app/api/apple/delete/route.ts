import { NextRequest, NextResponse } from "next/server";
import { ApplePhotosError, deleteAppleAsset } from "@/lib/apple-photos";

export const runtime = "nodejs";
export const maxDuration = 90;

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
    return NextResponse.json({ error: "Deletion must be confirmed in Image Genie on this Mac." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { id, confirmed, confirmation } = body as Record<string, unknown>;
  if (confirmed !== true || confirmation !== "DELETE" || typeof id !== "string" || !id || id.length > 300 || /[\x00-\x1f]/.test(id)) {
    return NextResponse.json({ error: "Review the warning, type DELETE, and select one valid Photos asset." }, { status: 400 });
  }

  try {
    await deleteAppleAsset(id);
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error instanceof ApplePhotosError ? error : new ApplePhotosError("Could not delete this Apple Photos asset.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
