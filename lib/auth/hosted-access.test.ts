import { describe, expect, it } from "vitest";
import {
  hostedOrganizationRoles,
  hostedPermissions,
  roleHasPermission
} from "./hosted-access";
import {
  isHostedAuthRequired,
  isPublicHostedPreviewEnvironment
} from "./hosted-config";

describe("hosted access policy", () => {
  it("requires authentication for a production Supabase deployment but not local mode", () => {
    expect(isHostedAuthRequired({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
      VERCEL_ENV: "production"
    } as NodeJS.ProcessEnv)).toBe(true);
    expect(isHostedAuthRequired({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable"
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("keeps the explicit public demo outside the authenticated tenant surface", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
      VERCEL_ENV: "production",
      LOOPGRAPH_PREVIEW_CONTENT: "1"
    } as NodeJS.ProcessEnv;
    expect(isPublicHostedPreviewEnvironment(env)).toBe(true);
    expect(isHostedAuthRequired(env)).toBe(false);
  });

  it("never lets preview content override explicit hosted mode", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
      LOOPGRAPH_HOSTED_MODE: "1",
      LOOPGRAPH_PREVIEW_CONTENT: "1"
    } as NodeJS.ProcessEnv;
    expect(isPublicHostedPreviewEnvironment(env)).toBe(false);
    expect(isHostedAuthRequired(env)).toBe(true);
  });

  it("uses a monotonic organization role hierarchy", () => {
    expect(hostedOrganizationRoles).toEqual(["viewer", "operator", "admin", "owner"]);
    expect(roleHasPermission("viewer", "workspace.read")).toBe(true);
    expect(roleHasPermission("viewer", "loops.write")).toBe(false);
    expect(roleHasPermission("operator", "loops.write")).toBe(true);
    expect(roleHasPermission("operator", "organization.manage")).toBe(false);
    expect(roleHasPermission("admin", "members.manage")).toBe(true);
    for (const permission of hostedPermissions) {
      expect(roleHasPermission("owner", permission)).toBe(true);
    }
  });
});
