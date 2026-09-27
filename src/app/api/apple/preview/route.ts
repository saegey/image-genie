import { NextRequest, NextResponse } from "next/server";
import { ApplePhotosError, getApplePreview } from "@/lib/apple-photos";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const cloud = request.nextUrl.searchParams.get("cloud") === "1";
  if (!id || id.length > 300) return NextResponse.json({ error: "Invalid Photos asset ID." }, { status: 400 });
  try {
    const reply = await getApplePreview(id, cloud);
    if (reply.status !== 200) return NextResponse.json({ error: reply.status === 409 ? "Preview is in iCloud." : "Preview unavailable." }, { status: reply.status });
    return new Response(new Uint8Array(reply.body), { headers: { "Content-Type": reply.contentType, "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    const failure = error instanceof ApplePhotosError ? error : new ApplePhotosError("Could not load Apple Photos preview.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
