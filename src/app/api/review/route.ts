import { NextRequest, NextResponse } from "next/server";
import { explainImmichError, getReview } from "@/lib/immich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const start = params.get("start");
  const end = params.get("end");
  const unalbumed = params.get("unalbumed") !== "false";
  const startTime = start ? Date.parse(start) : NaN;
  const endTime = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime || endTime - startTime > 366 * 86400000) {
    return NextResponse.json({ error: "Choose a valid date range of at most one year." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getReview(start!, end!, unalbumed), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = explainImmichError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
