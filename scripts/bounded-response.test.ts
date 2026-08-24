import { describe, expect, it } from "vitest";
import {
  readBoundedResponseJson,
  readBoundedResponseText
} from "./bounded-response";

describe("bounded staging responses", () => {
  it("rejects an oversized declared or streamed response", async () => {
    await expect(readBoundedResponseText(new Response("small", {
      headers: { "content-length": "1000" }
    }), 10, "test response")).rejects.toThrow(/size limit/i);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      }
    });
    await expect(readBoundedResponseText(
      new Response(stream),
      10,
      "test response"
    )).rejects.toThrow(/size limit/i);
  });

  it("decodes bounded JSON and rejects invalid UTF-8", async () => {
    await expect(readBoundedResponseJson(
      new Response(JSON.stringify({ ok: true })),
      1024
    )).resolves.toEqual({ ok: true });
    await expect(readBoundedResponseText(
      new Response(new Uint8Array([0xff, 0xff])),
      1024
    )).rejects.toBeDefined();
  });
});
