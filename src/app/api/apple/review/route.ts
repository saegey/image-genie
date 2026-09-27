import { NextRequest, NextResponse } from "next/server";
import { ApplePhotosError, getAppleReview } from "@/lib/apple-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");
  const startTime = start ? Date.parse(start) : NaN;
  const endTime = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime || endTime - startTime > 366 * 86400000) {
    return NextResponse.json({ error: "Choose a valid date range of at most one year." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getAppleReview(start!, end!), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error instanceof ApplePhotosError ? error : new ApplePhotosError("Could not read Apple Photos.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
