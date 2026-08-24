import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pluginRoot = path.join(repositoryRoot, "integrations", "hermes-plugin");

describe("Hermes native Loopgraph plugin", () => {
  it("keeps the plugin and Node runtime versions aligned", async () => {
    const manifest = YAML.parse(await readFile(path.join(pluginRoot, "plugin.yaml"), "utf8")) as {
      name: string;
      version: string;
      provides_hooks: string[];
      external_dependencies: string[];
    };
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const runtimeLock = JSON.parse(await readFile(path.join(pluginRoot, "runtime-lock.json"), "utf8")) as {
      pluginVersion: string;
      packageVersion: string;
      packageLockSha256: string;
      sourceRevisionPolicy: string;
    };
    const packageLock = await readFile(path.join(repositoryRoot, "package-lock.json"));

    expect(manifest).toMatchObject({
      name: "loopgraph",
      version: packageJson.version,
      provides_hooks: ["pre_llm_call"],
      external_dependencies: ["git", "node", "npm"]
    });
    expect(packageJson.name).toBe("loopgraph");
    expect(runtimeLock).toMatchObject({
      pluginVersion: manifest.version,
      packageVersion: packageJson.version,
      packageLockSha256: createHash("sha256").update(packageLock).digest("hex"),
      sourceRevisionPolicy: "hermes-install-revision"
    });
  });

  it("registers only the documented Hermes surfaces without registration side effects", () => {
    const script = String.raw`
import argparse
import contextlib
import importlib.util
import io
import json
import sys
from pathlib import Path

root = Path.cwd() / "integrations" / "hermes-plugin"
sys.dont_write_bytecode = True
package = type(sys)("hermes_plugins")
package.__path__ = []
sys.modules["hermes_plugins"] = package
spec = importlib.util.spec_from_file_location(
    "hermes_plugins.loopgraph",
    root / "__init__.py",
    submodule_search_locations=[str(root)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["hermes_plugins.loopgraph"] = module
spec.loader.exec_module(module)

class Context:
    def __init__(self):
        self.calls = []
    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args, kwargs))
        return call

ctx = Context()
module.register(ctx)
names = [call[0] for call in ctx.calls]
assert names == [
    "register_skill",
    "register_skill",
    "register_hook",
    "register_command",
    "register_cli_command",
], names
assert ctx.calls[0][2]["name"] == "design"
assert ctx.calls[1][2]["name"] == "event-router"

parser = argparse.ArgumentParser()
ctx.calls[-1][2]["setup_fn"](parser)
assert parser.parse_args(["version"]).loopgraph_handler
plan_args = parser.parse_args(["plan", "--project", str(root)])
assert plan_args.loopgraph_handler
assert parser.parse_args(["install", "--project", str(root)]).loopgraph_handler
assert parser.parse_args(["disconnect", "--project", str(root), "--yes"]).loopgraph_handler
assert parser.parse_args(["webhooks", "plan", "--project", str(root)]).loopgraph_handler

buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    plan_args.loopgraph_handler(plan_args)
plan = json.loads(buffer.getvalue())
assert plan["schemaVersion"] == "loopgraph-hermes-plugin-install-plan/v1alpha1"
assert len(plan["sourceRevision"]) == 40
assert plan["credentialsAccepted"] is False

hook = ctx.calls[2][1][1]
assert "loopgraph:design" in hook(user_message="start Loopgraph")["context"]
assert hook(user_message="Provider payload: start Loopgraph now") is None
print(json.dumps({"calls": names}))
`;

    const output = execFileSync("python3", ["-c", script], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    });
    expect(JSON.parse(output)).toEqual({
      calls: [
        "register_skill",
        "register_skill",
        "register_hook",
        "register_command",
        "register_cli_command"
      ]
    });
  });

  it("keeps bootstrap explicit, locked, and shell-free", async () => {
    const adapter = await readFile(
      path.join(pluginRoot, "loopgraph_plugin", "adapter.py"),
      "utf8"
    );

    expect(adapter).toContain('[npm, "ci", "--ignore-scripts"]');
    expect(adapter).toContain('[npm, "audit", "--omit=dev"]');
    expect(adapter).toContain("packageLockSha256");
    expect(adapter).toContain('[git, "fetch", "--depth", "1", "origin", revision]');
    expect(adapter).toContain("REVISION_PATTERN");
    expect(adapter).not.toMatch(/shell\s*=\s*True/);
    expect(adapter).not.toContain("os.system(");
    expect(adapter).not.toContain("subprocess.Popen(");
  });
});
