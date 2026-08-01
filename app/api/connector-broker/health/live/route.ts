import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ status: "live", service: "hermes-connector-broker" }, {
    headers: { "cache-control": "no-store" }
  });
}
