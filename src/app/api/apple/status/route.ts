import { NextResponse } from "next/server";
import { getAppleStatus } from "@/lib/apple-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAppleStatus(), { headers: { "Cache-Control": "no-store" } });
}
