import http from "node:http";
import type { AddressInfo } from "node:net";
import { trace } from "@opentelemetry/api";
import { afterAll, describe, expect, it } from "vitest";
import { withSpan } from "../src/telemetry/spans.js";
import { initTracing } from "../src/telemetry/tracing.js";

interface Received {
  url: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

/** A stand-in OTLP collector that records what it is sent. */
async function startCollector() {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        url: req.url,
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks),
      });
      res.writeHead(200, { "content-type": "application/x-protobuf" }).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? (address as AddressInfo).port : 0;
  return {
    endpoint: `http://127.0.0.1:${port}/v1/traces`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("exporting spans", () => {
  afterAll(() => trace.disable());

  it("sends them to the configured endpoint as OTLP protobuf, which is what Phoenix reads", async () => {
    const collector = await startCollector();
    const tracing = initTracing({
      enabled: true,
      endpoint: collector.endpoint,
      serviceName: "auratriage-test",
    });

    await withSpan("probe.export", { "triage.thread_id": "t-export" }, () => "done");
    await tracing.shutdown();
    await collector.close();

    expect(tracing.enabled).toBe(true);
    expect(collector.received).toHaveLength(1);
    const [request] = collector.received;
    expect(request?.url).toBe("/v1/traces");
    expect(request?.contentType).toBe("application/x-protobuf");
    const text = request?.body.toString("latin1") ?? "";
    expect(text).toContain("probe.export");
    expect(text).toContain("auratriage-test");
  });
});
