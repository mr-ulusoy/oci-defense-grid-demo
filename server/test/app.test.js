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
  const events = [
    {
      runId: "run-leaderboard",
      sessionId: "session-leaderboard",
      type: "enemy_killed",
      level: 2,
      score: 42000,
      callsign: "Ada Cloud",
      cloudAction: "ai_scan",
      metrics: { fps: 60, latencyMs: 12 },
      clientTs: new Date().toISOString()
    },
    {
      runId: "run-leaderboard",
      sessionId: "session-leaderboard",
      type: "run_end",
      level: 2,
      score: 44000,
      callsign: "Ada Cloud",
      cloudAction: "none",
      metrics: { fps: 60, latencyMs: 10 },
      clientTs: new Date().toISOString()
    }
  ];

  await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events })
  });

  const { body } = await request(app, "/api/leaderboard");

  assert.equal(body.entries[0].callsign, "ADA CLOUD");
  assert.equal(body.entries[0].score, 44000);
  assert.equal(body.entries[0].level, 2);
  assert.equal(body.entries[0].eventCounts.enemy_killed, 1);
  assert.equal(body.entries[0].eventCounts.run_end, 1);
});

test("live players lists latest player snapshots", async () => {
  const app = createApp();
  const events = [
    {
      runId: "run-live-a",
      sessionId: "session-live-a",
      type: "heartbeat",
      level: 2,
      score: 2100,
      callsign: "Sara",
      cloudAction: "none",
      metrics: { fps: 59, latencyMs: 32 },
      clientTs: new Date().toISOString()
    },
    {
      runId: "run-live-b",
      sessionId: "session-live-b",
      type: "enemy_killed",
      level: 3,
      score: 7200,
      callsign: "Ali",
      cloudAction: "rebalance_lb",
      metrics: { fps: 60, latencyMs: 44 },
      clientTs: new Date().toISOString()
    }
  ];

  await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events })
  });

  const { response, body } = await request(app, "/api/players/live");

  assert.equal(response.status, 200);
  assert.equal(body.players.length, 2);
  assert.equal(body.players[0].callsign, "ALI");
  assert.equal(body.players[0].score, 7200);
  assert.equal(body.players[0].eventCounts.enemy_killed, 1);
  assert.equal(body.players[1].callsign, "SARA");
  assert.equal(body.players[1].eventCounts.heartbeat, 1);
});

test("event analytics summarizes live game events", async () => {
  const app = createApp();
  const events = [
    {
      runId: "run-analytics-a",
      sessionId: "session-analytics-a",
      type: "enemy_killed",
      level: 4,
      score: 3200,
      callsign: "Analytics One",
      cloudAction: "rebalance_lb",
      metrics: { fps: 60, latencyMs: 34 },
      clientTs: new Date().toISOString()
    },
    {
      runId: "run-analytics-a",
      sessionId: "session-analytics-a",
      type: "player_hit",
      level: 4,
      score: 3400,
      callsign: "Analytics One",
      cloudAction: "shield",
      metrics: { fps: 58, latencyMs: 39 },
      clientTs: new Date().toISOString()
    },
    {
      runId: "run-analytics-b",
      sessionId: "session-analytics-b",
      type: "powerup",
      level: 2,
      score: 1800,
      callsign: "Analytics Two",
      cloudAction: "ai_scan",
      metrics: { fps: 59, latencyMs: 29 },
      clientTs: new Date().toISOString()
    },
    {
      runId: "run-analytics-b",
      sessionId: "session-analytics-b",
      type: "extra_life",
      level: 2,
      score: 1800,
      callsign: "Analytics Two",
      cloudAction: "ai_scan",
      metrics: { fps: 59, latencyMs: 29 },
      clientTs: new Date().toISOString()
    }
  ];

  await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events })
  });

  const { response, body } = await request(app, "/api/analytics/events");

  assert.equal(response.status, 200);
  assert.equal(body.source, "memory");
  assert.equal(body.windows.last15m, 4);
  assert.equal(body.eventTypes.find((eventType) => eventType.type === "enemy_killed").count, 1);
  assert.equal(body.eventTypes.find((eventType) => eventType.type === "player_hit").count, 1);
  assert.equal(body.eventTypes.find((eventType) => eventType.type === "powerup").count, 1);
  assert.equal(body.eventTypes.find((eventType) => eventType.type === "extra_life").count, 1);
  assert.equal(body.runs, undefined);
});

test("copilot endpoint rejects non-ops callers", async () => {
  const app = createApp();
  const { response, body } = await request(app, "/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot: { score: 1000 } })
  });

  assert.equal(response.status, 403);
  assert.equal(body.error, "Copilot is available in ops view only.");
});

test("stress endpoint rejects non-ops callers", async () => {
  const app = createApp();
  const { response, body } = await request(app, "/api/stress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationSeconds: 15 })
  });

  assert.equal(response.status, 403);
  assert.equal(body.error, "Stress is available in ops view only.");
});

test("stress endpoint starts bounded ops stress", async () => {
  const app = createApp({
    stressController: {
      status: () => ({ active: false, status: "idle" }),
      stop: () => ({ active: false, status: "stopped", stopped: true, stoppedWorkers: 2 }),
      start: ({ durationSeconds, workers }) => ({
        active: true,
        status: "running",
        durationSeconds,
        workers,
        remainingSeconds: durationSeconds,
        reused: false
      })
    }
  });
  const { response, body } = await request(app, "/api/stress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: true, durationSeconds: 30, workers: 2 })
  });

  assert.equal(response.status, 202);
  assert.equal(body.active, true);
  assert.equal(body.durationSeconds, 30);
  assert.equal(body.workers, 2);
});

test("stress endpoint stops bounded ops stress", async () => {
  const app = createApp({
    stressController: {
      status: () => ({ active: true, status: "running" }),
      start: () => ({ active: true, status: "running" }),
      stop: () => ({ active: false, status: "stopped", stopped: true, stoppedWorkers: 2 })
    }
  });
  const { response, body } = await request(app, "/api/stress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: true, action: "stop" })
  });

  assert.equal(response.status, 202);
  assert.equal(body.active, false);
  assert.equal(body.status, "stopped");
  assert.equal(body.stoppedWorkers, 2);
});

test("copilot endpoint accepts ops callers", async () => {
  const app = createApp({
    createInsight: async () => "Ops insight"
  });
  const { response, body } = await request(app, "/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: true, snapshot: { score: 1000 } })
  });

  assert.equal(response.status, 200);
  assert.equal(body.insight, "Ops insight");
});
