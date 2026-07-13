import { LoopsWorkspace } from "@/components/loops/loops-workspace";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopsPage({
  searchParams
}: {
  searchParams?: Promise<{ preview?: string; department?: string; status?: string }>;
}) {
  const params = await searchParams;
  const department = params?.department ?? "all";
  let workspace = await getWorkspace(params?.preview);
  if (department !== "all" && workspace.loop.department !== department) {
    const firstDepartmentLoop = workspace.loops.find((loop) => loop.department === department);
    if (firstDepartmentLoop) {
      workspace = await getWorkspace(firstDepartmentLoop.id);
    }
  }

  return (
    <LoopsWorkspace
      department={department}
      status={params?.status ?? "all"}
      workspace={workspace}
    />
  );
}
