import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("liveness API", () => {
  it("returns a cache-free process liveness signal", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "live",
      service: "loopgraph"
    });
  });
});
