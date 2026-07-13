import { describe, expect, it } from "vitest";
import { isGitHubAdapterConfigured } from "./context-compiler";

describe("execute path configuration", () => {
  it("detects when GitHub adapter env is missing", () => {
    const original = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_OWNER: process.env.GITHUB_OWNER,
      GITHUB_REPO: process.env.GITHUB_REPO
    };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_REPO;
    expect(isGitHubAdapterConfigured()).toBe(false);
    process.env.GITHUB_TOKEN = original.GITHUB_TOKEN;
    process.env.GITHUB_OWNER = original.GITHUB_OWNER;
    process.env.GITHUB_REPO = original.GITHUB_REPO;
  });

  it("detects when GitHub adapter env is present", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_OWNER = "acme";
    process.env.GITHUB_REPO = "demo";
    expect(isGitHubAdapterConfigured()).toBe(true);
  });
});
