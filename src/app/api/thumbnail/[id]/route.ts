import { NextRequest, NextResponse } from "next/server";
import { explainImmichError, getThumbnail } from "@/lib/immich";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid asset ID." }, { status: 400 });
  try {
    const blob = await getThumbnail(id);
    return new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg", "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    const failure = explainImmichError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
