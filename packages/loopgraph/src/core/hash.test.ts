import { describe, expect, it } from "vitest";
import {
  contentDigest,
  contentHash,
  loopSpecVersionHash
} from "./hash";

describe("content hashing", () => {
  it("keeps compact runtime IDs while using a full digest for immutable versions", () => {
    const value = { b: 2, a: 1 };
    expect(contentHash(value)).toMatch(/^[a-f0-9]{16}$/);
    expect(contentDigest(value)).toMatch(/^[a-f0-9]{64}$/);
    expect(loopSpecVersionHash(value)).toBe(contentDigest(value));
    expect(contentDigest({ a: 1, b: 2 })).toBe(contentDigest(value));
  });
});
