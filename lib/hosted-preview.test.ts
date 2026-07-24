import { afterEach, describe, expect, it } from "vitest";
import { isHostedPreview } from "./hosted-preview";

const originalProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const originalPreviewContent = process.env.LOOPGRAPH_PREVIEW_CONTENT;

afterEach(() => {
  if (originalProductionUrl === undefined) {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  } else {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = originalProductionUrl;
  }

  if (originalPreviewContent === undefined) {
    delete process.env.LOOPGRAPH_PREVIEW_CONTENT;
  } else {
    process.env.LOOPGRAPH_PREVIEW_CONTENT = originalPreviewContent;
  }
});

describe("isHostedPreview", () => {
  it("is disabled for a normal local install", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.LOOPGRAPH_PREVIEW_CONTENT;

    expect(isHostedPreview()).toBe(false);
  });

  it("is enabled only for the Loopgraph Vercel project", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "loopgraph.vercel.app";
    delete process.env.LOOPGRAPH_PREVIEW_CONTENT;

    expect(isHostedPreview()).toBe(true);
  });

  it("stays disabled for a fork deployed to another Vercel project", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "loopgraph-fork.vercel.app";
    delete process.env.LOOPGRAPH_PREVIEW_CONTENT;

    expect(isHostedPreview()).toBe(false);
  });

  it("can be enabled explicitly for local preview QA", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.LOOPGRAPH_PREVIEW_CONTENT = "1";

    expect(isHostedPreview()).toBe(true);
  });
});
