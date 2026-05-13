import assert from "node:assert/strict";
import { test } from "node:test";
import { createIngestHandler, normalizeCallsign, normalizeEvent, parsePayload } from "../lib/handler.js";

function createHttpContext(method = "POST") {
  return {
    httpGateway: {
      method,
      statusCode: 200,
      headers: {},
      setResponseHeader(key, value) {
        this.headers[key] = value;
      }
    }
  };
}

const identity = () => ({
  id: "fn-test",
  name: "event-ingest-test",
  availabilityDomain: "serverless",
  region: "eu-stockholm-1"
});

test("normalizes callsigns for leaderboard compatibility", () => {
  assert.equal(normalizeCallsign(" Ada Cloud!! "), "ADA CLOUD");
  assert.equal(normalizeCallsign(""), "UNKNOWN");
});

test("normalizes valid events with function identity", () => {
  const event = normalizeEvent(
    {
      runId: "run-test",
      sessionId: "session-test",
      type: "enemy_killed",
      level: 4,
      score: 120,
      callsign: "Pilot One",
      cloudAction: "ai_scan",
      metrics: { fps: 60, latencyMs: 12 },
      clientTs: "2026-05-13T10:00:00.000Z"
    },
    identity()
  );

  assert.equal(event.type, "enemy_killed");
  assert.equal(event.callsign, "PILOT ONE");
  assert.equal(event.vm.name, "event-ingest-test");
});

test("parses JSON body fallback when FDK input is empty", () => {
  const payload = parsePayload({}, { body: "{\"type\":\"heartbeat\"}" });
  assert.equal(payload.type, "heartbeat");
});

test("ingest handler accepts valid telemetry batch", async () => {
  let recorded = [];
  const handler = createIngestHandler({
    identity,
    recordEvents: async (events) => {
      recorded = events;
      return {
        redisLivePlayers: "connected",
        autonomousDatabase: "connected",
        streaming: "connected",
        objectStorage: "connected"
      };
    }
  });
  const ctx = createHttpContext();

  const response = await handler(
    {
      events: [
        {
          runId: "run-test",
          sessionId: "session-test",
          type: "run_end",
          level: 6,
          score: 9001,
          callsign: "Sara",
          cloudAction: "none",
          metrics: { fps: 60, latencyMs: 20 },
          clientTs: "2026-05-13T10:00:00.000Z"
        }
      ]
    },
    ctx
  );

  assert.equal(ctx.httpGateway.statusCode, 202);
  assert.equal(response.accepted, 1);
  assert.equal(response.ingest, "oci-functions");
  assert.equal(recorded[0].callsign, "SARA");
});

test("ingest handler rejects invalid telemetry", async () => {
  const handler = createIngestHandler({ identity });
  const ctx = createHttpContext();
  const response = await handler({ type: "bad_event" }, ctx);

  assert.equal(ctx.httpGateway.statusCode, 400);
  assert.match(response.error, /No valid telemetry/);
});
