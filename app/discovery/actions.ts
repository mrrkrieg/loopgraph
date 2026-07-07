"use server";

import { revalidatePath } from "next/cache";
import {
  acceptRecommendation,
  buildDemoDiscoverySession,
  loadDiscoverySession,
  materializeAcceptedLoops,
  rejectRecommendation,
  saveDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";
import { demoDiscoverySessionId } from "./view-data";

async function loadOrCreateSession() {
  const session = (await loadDiscoverySession(demoDiscoverySessionId)) ?? await buildDemoDiscoverySession();
  await saveDiscoverySession(session);
  return session;
}

export async function acceptRecommendationAction(formData: FormData) {
  const recommendationId = String(formData.get("recommendationId") ?? "");
  const session = await loadOrCreateSession();
  await saveDiscoverySession(acceptRecommendation(session, recommendationId));
  revalidatePath("/discovery");
  revalidatePath("/discovery/recommendations");
  revalidatePath("/discovery/create-loops");
}

export async function rejectRecommendationAction(formData: FormData) {
  const recommendationId = String(formData.get("recommendationId") ?? "");
  const session = await loadOrCreateSession();
  await saveDiscoverySession(rejectRecommendation(session, recommendationId));
  revalidatePath("/discovery");
  revalidatePath("/discovery/recommendations");
  revalidatePath("/discovery/create-loops");
}

export async function materializeAcceptedRecommendationsAction() {
  const session = await loadOrCreateSession();
  await materializeAcceptedLoops(session);
  revalidatePath("/discovery/create-loops");
  revalidatePath("/topology");
  revalidatePath("/loops");
}

