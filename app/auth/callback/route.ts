import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next")) ?? "/";
  const supabase = await createSupabaseServerClient();
  if (!code || !supabase) {
    return NextResponse.redirect(new URL("/sign-in?error=invalid_callback", url.origin));
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/sign-in?error=authentication_failed", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

function safeNextPath(value: string | null): string | undefined {
  return value?.startsWith("/") && !value.startsWith("//") ? value : undefined;
}
