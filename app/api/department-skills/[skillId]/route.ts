import { NextResponse } from "next/server";
import { loadDepartmentSkillPack, validateDepartmentSkillPackReferences } from "@/lib/loopgraph-runtime/skill-pack-loader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ skillId: string }> }
) {
  const { skillId } = await params;
  const pack = await loadDepartmentSkillPack(skillId);
  return pack
    ? NextResponse.json({ pack, errors: validateDepartmentSkillPackReferences(pack) })
    : NextResponse.json({ error: "Skill pack not found" }, { status: 404 });
}

