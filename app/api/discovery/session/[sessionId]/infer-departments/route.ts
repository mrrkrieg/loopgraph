import { NextResponse } from "next/server";
import {
  inferDepartments,
  loadDiscoverySession,
  saveDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";
import { loadDepartmentSkillPacks } from "@/lib/loopgraph-runtime/skill-pack-loader";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await loadDiscoverySession(sessionId);
  if (!session) return NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
  const departmentProfiles = inferDepartments(session, await loadDepartmentSkillPacks());
  const next = { ...session, departmentProfiles, status: "department_questions" as const, updatedAt: new Date().toISOString() };
  await saveDiscoverySession(next);
  return NextResponse.json(next);
}

