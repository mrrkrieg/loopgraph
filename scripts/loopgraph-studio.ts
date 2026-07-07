#!/usr/bin/env tsx
/** Design Studio CLI extensions: full template catalog and workspace register. */
import "./load-env";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { Command } from "commander";
import { createSpecFromTemplate } from "../lib/loop-engineering-builder/template-spec";
import { getDepartmentTemplates, getTemplateById, getTemplateCatalog } from "../lib/loop-engineering-builder/templates";
import { registerLoopSpec } from "../lib/loop-engineering-builder/local-workspace";

const program = new Command();
const repoRoot = path.resolve(__dirname, "..");

program.name("loopgraph-studio").description("Loopgraph Design Studio CLI extensions");

program
  .command("init")
  .argument("<template>", "Template id")
  .argument("[targetDir]", "Destination directory", ".")
  .option("--register", "Register the initialized spec in .loopgraph/workspace.json")
  .action(async (templateId, targetDir, options: { register?: boolean }) => {
    const template = getTemplateById(templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      process.exit(1);
    }

    const dest = path.resolve(targetDir);
    const outputDir = path.join(dest, template.id);
    await mkdir(dest, { recursive: true });

    if (template.runtimeLevel === "runnable" && template.examplePath) {
      const source = path.join(repoRoot, template.examplePath);
      await cp(source, outputDir, { recursive: true, force: true });
      const fixtureSource = path.join(repoRoot, "fixtures", template.id);
      try {
        await cp(fixtureSource, path.join(dest, "fixtures", template.id), { recursive: true, force: true });
      } catch {
        // Some runnable examples do not ship fixtures yet.
      }
    } else {
      await mkdir(outputDir, { recursive: true });
      const spec = createSpecFromTemplate(template.id);
      await writeFile(path.join(outputDir, "loopgraph.yaml"), YAML.stringify(spec));
    }

    const specPath = path.join(outputDir, "loopgraph.yaml");
    if (options.register) {
      const entry = await registerLoopSpec(specPath, repoRoot);
      console.log(`Registered ${entry.name} (${entry.id})`);
    }
    console.log(`Initialized ${template.id} in ${outputDir}`);
  });

const templates = program.command("templates").description("Full Design Studio template catalog");

templates
  .command("list")
  .option("--json", "Print raw JSON")
  .action((options: { json?: boolean }) => {
    const catalog = getTemplateCatalog();
    if (options.json) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }

    for (const department of getDepartmentTemplates()) {
      console.log(`\n${department.name}`);
      for (const template of department.commonLoops) {
        console.log(`- ${template.id} [${template.runtimeLevel}] ${template.name}`);
      }
    }
  });

templates
  .command("show")
  .argument("<templateId>", "Template id")
  .action((templateId) => {
    const template = getTemplateById(templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(template, null, 2));
  });

program
  .command("register")
  .argument("<specPath>", "Path to loopgraph.yaml or example directory")
  .action(async (specPath) => {
    const entry = await registerLoopSpec(specPath, repoRoot);
    console.log(`Registered ${entry.name} (${entry.id}) from ${entry.path}`);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
