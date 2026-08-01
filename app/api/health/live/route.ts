import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "live",
    service: "loopgraph",
    version: process.env.npm_package_version ?? "0.2.0",
    checkedAt: new Date().toISOString()
  }, {
    headers: { "cache-control": "no-store" }
  });
}
