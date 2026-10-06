import { NextRequest, NextResponse } from "next/server";
import { addConfirmedAssetsToAlbum, explainImmichError } from "@/lib/immich";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { albumId, assetIds, confirmed } = body as Record<string, unknown>;
  const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
  if (confirmed !== true || !validId(albumId) || !Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > 500 || !assetIds.every(validId) || new Set(assetIds).size !== assetIds.length) {
    return NextResponse.json({ error: "Confirm an existing album and one or more valid assets." }, { status: 400 });
  }

  try {
    await addConfirmedAssetsToAlbum(albumId, assetIds);
    return NextResponse.json({ albumId, count: assetIds.length });
  } catch (error) {
    const failure = explainImmichError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
