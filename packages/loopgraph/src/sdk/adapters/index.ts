import { githubAdapter } from "./github";
import { marketingMvpAdapters } from "./marketing-mvp";
import { allMockAdapters } from "./mock-adapters";
import type { IntegrationAdapter } from "../adapters";

export const allAdapters: IntegrationAdapter[] = [...allMockAdapters, ...marketingMvpAdapters, githubAdapter];

export function getAdapterById(id: string) {
  return allAdapters.find((adapter) => adapter.id === id);
}
