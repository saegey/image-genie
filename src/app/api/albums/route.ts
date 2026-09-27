import { NextRequest, NextResponse } from "next/server";
import { createConfirmedAlbum, explainImmichError } from "@/lib/immich";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { name, assetIds, confirmed } = body as Record<string, unknown>;
  if (confirmed !== true || typeof name !== "string" || !name.trim() || name.length > 200 || !Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > 500 || !assetIds.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) || new Set(assetIds).size !== assetIds.length) {
    return NextResponse.json({ error: "Confirm an album name and one or more valid assets." }, { status: 400 });
  }
  try {
    const album = await createConfirmedAlbum(name.trim(), assetIds);
    return NextResponse.json({ id: album.id, name: album.albumName, count: album.assetCount }, { status: 201 });
  } catch (error) {
    const failure = explainImmichError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
