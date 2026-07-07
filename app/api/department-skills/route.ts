import { NextResponse } from "next/server";
import { loadDepartmentSkillPacks, validateDepartmentSkillPackReferences } from "@/lib/loopgraph-runtime/skill-pack-loader";

export async function GET() {
  const packs = await loadDepartmentSkillPacks();
  return NextResponse.json({
    packs,
    errors: packs.flatMap(validateDepartmentSkillPackReferences)
  });
}

