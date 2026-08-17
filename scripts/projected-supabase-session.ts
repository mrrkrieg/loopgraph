import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";

const sessionSchema = z.object({
  access_token: z.string()
    .min(32)
    .max(64 * 1024)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  refresh_token: z.string()
    .min(32)
    .max(64 * 1024)
    .regex(/^[A-Za-z0-9._~-]+$/)
}).strict();

export type ProjectedSupabaseSession = z.infer<typeof sessionSchema>;

type CookieRecord = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

type SessionClientFactory = (
  url: string,
  publishableKey: string,
  options: {
    cookies: {
      getAll(): Array<{ name: string; value: string }>;
      setAll(cookies: CookieRecord[]): void;
    };
  }
) => {
  auth: {
    setSession(session: ProjectedSupabaseSession): Promise<{ error: unknown }>;
  };
};

export async function readProjectedSupabaseSessionFile(
  file: string,
  label: string
): Promise<ProjectedSupabaseSession> {
  if (!path.isAbsolute(file)) {
    throw new Error(`${label} must be an absolute projected-session path`);
  }
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 64 || metadata.size > 128 * 1024) {
      throw new Error(`${label} must reference one bounded regular file`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`${label} must not be readable or writable by group or other users`);
    }
    let value: unknown;
    try {
      value = JSON.parse(await handle.readFile("utf8"));
    } catch {
      throw new Error(`${label} did not contain one JSON session bundle`);
    }
    const parsed = sessionSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`${label} did not contain a bounded Supabase session bundle`);
    }
    return parsed.data;
  } finally {
    await handle?.close();
  }
}

export async function createSupabaseSessionCookieHeader(
  config: {
    supabaseUrl: string;
    publishableKey: string;
    session: ProjectedSupabaseSession;
  },
  dependencies: {
    clientFactory?: SessionClientFactory;
  } = {}
): Promise<string> {
  const url = trustedSupabaseOrigin(config.supabaseUrl);
  if (config.publishableKey.length < 20 || config.publishableKey.length > 64 * 1024) {
    throw new Error("Staging Supabase publishable key is invalid");
  }
  const jar = new Map<string, string>();
  const clientFactory =
    dependencies.clientFactory ?? (createServerClient as SessionClientFactory);
  const client = clientFactory(url.origin, config.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          validateCookiePair(cookie.name, cookie.value);
          if (cookie.value) jar.set(cookie.name, cookie.value);
          else jar.delete(cookie.name);
        }
      }
    }
  });
  const { error } = await client.auth.setSession(config.session);
  if (error || jar.size === 0) {
    throw new Error("Projected staging user session could not be exchanged for browser cookies");
  }
  const header = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  if (header.length > 128 * 1024) {
    throw new Error("Projected staging user session produced an oversized cookie header");
  }
  return header;
}

function trustedSupabaseOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Staging Supabase URL must be one HTTPS origin");
  }
  return url;
}

function validateCookiePair(name: string, value: string) {
  if (
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
    /[;\r\n\0]/.test(value) ||
    value.length > 64 * 1024
  ) {
    throw new Error("Supabase returned an invalid browser cookie");
  }
}
