import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const forbidden = ["loop-engineering-builder", "next/", "@supabase/", "from \"next\"", "from 'next'"];

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("package boundary", () => {
  it("does not import app-only modules", () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(packageSrc)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (content.includes(pattern)) {
          violations.push(`${path.relative(packageSrc, file)}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
