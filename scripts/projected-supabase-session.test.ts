import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseSessionCookieHeader,
  readProjectedSupabaseSessionFile
} from "./projected-supabase-session";

const temporaryDirectories: string[] = [];
const session = {
  access_token: `header.${"a".repeat(40)}.signature`,
  refresh_token: `refresh_${"b".repeat(40)}`
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("projected Supabase user sessions", () => {
  it("reads only a strict session bundle from a private regular file", async () => {
    const directory = await temporaryDirectory();
    const file = path.join(directory, "allowed.json");
    await writeFile(file, JSON.stringify(session), { mode: 0o600 });
    await expect(readProjectedSupabaseSessionFile(file, "allowed session"))
      .resolves.toEqual(session);

    await chmod(file, 0o640);
    await expect(readProjectedSupabaseSessionFile(file, "allowed session"))
      .rejects.toThrow(/group or other users/i);
  });

  it("rejects symlinks and extra session fields", async () => {
    const directory = await temporaryDirectory();
    const target = path.join(directory, "target.json");
    const link = path.join(directory, "link.json");
    await writeFile(target, JSON.stringify(session), { mode: 0o600 });
    await symlink(target, link);
    await expect(readProjectedSupabaseSessionFile(link, "session"))
      .rejects.toBeDefined();

    const expanded = path.join(directory, "expanded.json");
    await writeFile(expanded, JSON.stringify({ ...session, user: { email: "private@example.com" } }), {
      mode: 0o600
    });
    await expect(readProjectedSupabaseSessionFile(expanded, "session"))
      .rejects.toThrow(/bounded Supabase session bundle/i);
  });

  it("exchanges a session through the Supabase client without returning token text", async () => {
    const clientFactory = vi.fn((_url, _key, options) => ({
      auth: {
        setSession: vi.fn(async (received) => {
          expect(received).toEqual(session);
          options.cookies.setAll([
            { name: "sb-test-auth-token.0", value: "base64-part-one" },
            { name: "sb-test-auth-token.1", value: "base64-part-two" }
          ]);
          return { error: null };
        })
      }
    }));
    const header = await createSupabaseSessionCookieHeader({
      supabaseUrl: "https://database.example",
      publishableKey: "publishable_key_long_enough",
      session
    }, { clientFactory });

    expect(header).toBe(
      "sb-test-auth-token.0=base64-part-one; sb-test-auth-token.1=base64-part-two"
    );
    expect(header).not.toContain(session.access_token);
    expect(header).not.toContain(session.refresh_token);
  });

  it("rejects cookie injection and generic session exchange failures", async () => {
    await expect(createSupabaseSessionCookieHeader({
      supabaseUrl: "https://database.example",
      publishableKey: "publishable_key_long_enough",
      session
    }, {
      clientFactory: (_url, _key, options) => ({
        auth: {
          setSession: async () => {
            options.cookies.setAll([{ name: "valid", value: "bad; injected=true" }]);
            return { error: null };
          }
        }
      })
    })).rejects.toThrow(/invalid browser cookie/i);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "loopgraph-session-file-"));
  temporaryDirectories.push(directory);
  return directory;
}
