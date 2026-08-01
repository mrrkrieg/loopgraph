import { providerIdSchema } from "loopgraph/core";
import { handleConnectorOAuthCallback } from "../../callback/route";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await context.params;
  const parsed = providerIdSchema.safeParse(providerId);
  if (!parsed.success) return handleConnectorOAuthCallback(new Request("https://invalid.local/?error=invalid_provider"));
  return handleConnectorOAuthCallback(request, parsed.data);
}
