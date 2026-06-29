import { githubAdapter } from "./github";
import { allMockAdapters } from "./mock-adapters";
import type { IntegrationAdapter } from "../adapters";

export const allAdapters: IntegrationAdapter[] = [...allMockAdapters, githubAdapter];

export function getAdapterById(id: string) {
  return allAdapters.find((adapter) => adapter.id === id);
}
