import { describe, expect, it } from "vitest";
import { signHermesExecutionPayload, verifyHermesExecutionPayload } from "./hermes-execution-transport";

describe("Hermes execution signatures", () => {
  it("binds the timestamp and exact payload and rejects stale deliveries", () => {
    const body = JSON.stringify({ assignmentId: "assignment_sales" });
    const timestamp = "1785513600";
    const secret = "a-secure-hermes-execution-secret-32-bytes";
    const signature = signHermesExecutionPayload(body, timestamp, secret);
    expect(verifyHermesExecutionPayload({ body, timestamp, signature, secret, now: new Date("2026-07-31T16:00:00.000Z") })).toBe(true);
    expect(verifyHermesExecutionPayload({ body: `${body} `, timestamp, signature, secret, now: new Date("2026-07-31T16:00:00.000Z") })).toBe(false);
    expect(verifyHermesExecutionPayload({ body, timestamp, signature, secret, now: new Date("2026-07-31T17:00:00.000Z") })).toBe(false);
  });
});
