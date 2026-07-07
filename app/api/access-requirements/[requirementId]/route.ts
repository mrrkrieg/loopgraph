import { NextResponse } from "next/server";
import {
  listAccessRequirements,
  saveAccessRequirement
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requirementId: string }> }
) {
  const { requirementId } = await params;
  const body = await request.json();
  const items = await listAccessRequirements();
  const item = items.find((requirement) => requirement.id === requirementId);
  if (!item) return NextResponse.json({ error: "Access requirement not found" }, { status: 404 });
  const next = { ...item, ...body };
  await saveAccessRequirement(next);
  return NextResponse.json(next);
}

