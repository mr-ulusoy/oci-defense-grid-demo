import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createCopilotInsight } from "../src/copilot.js";

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
  assert.equal(body.eventIngestRouteMode, "vm-api");
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

test("leaderboard insight endpoint is ops-only and returns card copy", async () => {
  let capturedEntries = [];
  const app = createApp({
    createCardInsights: async (entries) => {
      capturedEntries = entries;
      return {
        cards: [
          {
            runId: entries[0]?.runId,
            callsign: entries[0]?.callsign,
            title: "Clean analysis",
            headline: "12 kills, 1 hit.",
            detail: "Low damage and steady progress show controlled survival.",
            tone: "clean"
          }
        ],
        source: "oci-genai",
        modelLabel: "Gemini 2.5 Flash-Lite"
      };
    }
  });

  const forbidden = await request(app, "/api/leaderboard/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(forbidden.response.status, 403);

  await request(app, "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "run_end",
      runId: "run-card-copy",
      sessionId: "session-card-copy",
      level: 5,
      score: 999999,
      callsign: "Card Pilot",
      clientTs: new Date().toISOString()
    })
  });

  const { response, body } = await request(app, "/api/leaderboard/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: true })
  });

  assert.equal(response.status, 200);
  assert.equal(body.source, "oci-genai");
  assert.equal(body.cards[0].title, "Clean analysis");
  assert.equal(body.modelLabel, "Gemini 2.5 Flash-Lite");
  assert.equal(capturedEntries[0].callsign, "CARD PILOT");
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
  assert.equal(body.error, "Ops access is required.");
});

test("stress endpoint rejects non-ops callers", async () => {
  const app = createApp();
  const { response, body } = await request(app, "/api/stress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationSeconds: 15 })
  });

  assert.equal(response.status, 403);
  assert.equal(body.error, "Ops access is required.");
});

test("ops endpoints allow ops callers without browser tokens", async () => {
  const previousToken = process.env.OPS_ACCESS_TOKEN;
  process.env.OPS_ACCESS_TOKEN = "test-ops-token";
  const app = createApp({
    createInsight: async () => ({ insight: "authorized", source: "test" })
  });

  try {
    const authorized = await request(app, "/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: true, snapshot: { score: 1000 } })
    });
    assert.equal(authorized.response.status, 200);
    assert.equal(authorized.body.insight, "authorized");
  } finally {
    if (previousToken === undefined) delete process.env.OPS_ACCESS_TOKEN;
    else process.env.OPS_ACCESS_TOKEN = previousToken;
  }
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
  assert.equal(body.mode, "live");
  assert.equal(body.source, "unknown");
});

test("copilot endpoint supports deep analysis modes", async () => {
  let capturedContext;
  const app = createApp({
    createInsight: async (context) => {
      capturedContext = context;
      return {
        insight: "Leaderboard analysis",
        source: "oci-genai",
        model: "google.gemini-2.5-pro",
        modelLabel: "Gemini 2.5 Pro",
        latencyMs: 42,
        mode: context.mode
      };
    }
  });
  const { response, body } = await request(app, "/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: true, mode: "leaderboard", snapshot: { topScore: 1000 } })
  });

  assert.equal(response.status, 200);
  assert.equal(body.insight, "Leaderboard analysis");
  assert.equal(body.source, "oci-genai");
  assert.equal(body.modelLabel, "Gemini 2.5 Pro");
  assert.equal(body.latencyMs, 42);
  assert.equal(body.mode, "leaderboard");
  assert.equal(capturedContext.mode, "leaderboard");
  assert.ok(Array.isArray(capturedContext.leaderboard));
});

test("live copilot separates active players from completed leaderboard", async () => {
  const previousEnv = {
    endpoint: process.env.OCI_GENAI_ENDPOINT,
    bearer: process.env.OCI_GENAI_BEARER_TOKEN,
    compartment: process.env.OCI_GENAI_COMPARTMENT_OCID
  };
  process.env.OCI_GENAI_ENDPOINT = "";
  delete process.env.OCI_GENAI_BEARER_TOKEN;
  delete process.env.OCI_GENAI_COMPARTMENT_OCID;

  try {
    const result = await createCopilotInsight({
      mode: "live",
      livePlayers: [
        {
          callsign: "CAPPO",
          score: 75700,
          level: 3,
          eventCounts: {
            enemy_killed: 234,
            player_hit: 18,
            powerup: 48,
            extra_life: 1,
            boss_phase: 4
          }
        },
        {
          callsign: "AH",
          score: 24000,
          level: 2,
          eventCounts: {
            enemy_killed: 80,
            player_hit: 4,
            powerup: 10,
            boss_phase: 1
          }
        }
      ],
      leaderboard: [
        {
          callsign: "CANO",
          score: 280750,
          level: 5,
          eventCounts: {
            enemy_killed: 524,
            player_hit: 17,
            powerup: 85,
            extra_life: 6,
            boss_phase: 10
          }
        }
      ]
    });

    assert.equal(result.source, "fallback");
    assert.match(result.insight, /2 active pilots/);
    assert.match(result.insight, /CAPPO leads live/);
    assert.match(result.insight, /CANO still holds the completed-run leaderboard/);
  } finally {
    if (previousEnv.endpoint === undefined) delete process.env.OCI_GENAI_ENDPOINT;
    else process.env.OCI_GENAI_ENDPOINT = previousEnv.endpoint;
    if (previousEnv.bearer === undefined) delete process.env.OCI_GENAI_BEARER_TOKEN;
    else process.env.OCI_GENAI_BEARER_TOKEN = previousEnv.bearer;
    if (previousEnv.compartment === undefined) delete process.env.OCI_GENAI_COMPARTMENT_OCID;
    else process.env.OCI_GENAI_COMPARTMENT_OCID = previousEnv.compartment;
  }
});

test("coach endpoint accepts valid quiz context", async () => {
  const app = createApp({
    createCoach: async ({ questionId }) => ({
      questionId,
      reply: "Think about the path for game pages separately from API calls.",
      source: "fallback"
    })
  });
  const { response, body } = await request(app, "/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "run-coach",
      sessionId: "session-coach",
      level: 2,
      questionId: "api-lb-route",
      message: "Can I get a hint?",
      attemptCount: 1
    })
  });

  assert.equal(response.status, 200);
  assert.equal(body.questionId, "api-lb-route");
  assert.equal(body.source, "fallback");
});

test("coach endpoint rejects unknown quiz context", async () => {
  const app = createApp();
  const { response, body } = await request(app, "/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      level: 2,
      questionId: "not-a-real-question",
      message: "Help"
    })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, "Unknown quiz coach context.");
});

test("coach endpoint rejects overlong messages", async () => {
  const app = createApp();
  const { response, body } = await request(app, "/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      level: 2,
      questionId: "api-lb-route",
      message: "x".repeat(301)
    })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, "Coach message must be 300 characters or fewer.");
});

test("coach endpoint rate limits repeated AI help requests", async () => {
  const previousLimit = process.env.COACH_AI_RATE_LIMIT_PER_MINUTE;
  process.env.COACH_AI_RATE_LIMIT_PER_MINUTE = "1";
  const app = createApp({
    createCoach: async () => ({ questionId: "api-lb-route", reply: "hint", source: "test" })
  });
  const payload = {
    level: 2,
    questionId: "api-lb-route",
    sessionId: "rate-session",
    message: "hint please"
  };

  try {
    const first = await request(app, "/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const second = await request(app, "/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 429);
    assert.equal(second.body.error, "Coach AI rate limit exceeded.");
  } finally {
    if (previousLimit === undefined) delete process.env.COACH_AI_RATE_LIMIT_PER_MINUTE;
    else process.env.COACH_AI_RATE_LIMIT_PER_MINUTE = previousLimit;
  }
});
