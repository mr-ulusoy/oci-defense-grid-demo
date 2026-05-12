import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";

function request(app, path, options = {}) {
  const server = createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
        const body = await response.json();
        resolve({ response, body });
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test("status endpoint returns VM identity", async () => {
  const app = createApp();
  const { response, body } = await request(app, "/api/status");

  assert.equal(response.status, 200);
  assert.equal(body.vm.name, "local-demo");
  assert.equal(typeof body.vm.metrics.cpuCores, "number");
  assert.equal(typeof body.vm.metrics.cpuPercent, "number");
  assert.equal(typeof body.vm.metrics.ramPercent, "number");
  assert.equal(typeof body.vm.metrics.diskIo.readKbps, "number");
  assert.equal(typeof body.vm.metrics.diskIo.writeKbps, "number");
});

test("events endpoint accepts valid telemetry batch", async () => {
  const app = createApp();
  const event = {
    runId: "run-test",
    sessionId: "session-test",
    type: "enemy_killed",
    level: 1,
    score: 120,
    callsign: "Pilot One",
    cloudAction: "rebalance_lb",
    metrics: { fps: 60, latencyMs: 20 },
    clientTs: new Date().toISOString()
  };

  const { response, body } = await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [event] })
  });

  assert.equal(response.status, 202);
  assert.equal(body.accepted, 1);
});

test("events endpoint rejects invalid payloads", async () => {
  const app = createApp();
  const { response } = await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "bad_event" })
  });

  assert.equal(response.status, 400);
});

test("leaderboard uses submitted player callsign", async () => {
  const app = createApp();
  const event = {
    runId: "run-leaderboard",
    sessionId: "session-leaderboard",
    type: "run_end",
    level: 2,
    score: 44000,
    callsign: "Ada Cloud",
    cloudAction: "none",
    metrics: { fps: 60, latencyMs: 10 },
    clientTs: new Date().toISOString()
  };

  await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [event] })
  });

  const { body } = await request(app, "/api/leaderboard");

  assert.equal(body.entries[0].callsign, "ADA CLOUD");
  assert.equal(body.entries[0].score, 44000);
});
