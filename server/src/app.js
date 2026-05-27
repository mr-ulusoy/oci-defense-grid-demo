import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import {
  createCoachReply,
  createCopilotInsight,
  createLeaderboardCardInsights
} from "./copilot.js";
import { startStress, stopStress, stressStatus } from "./demoStress.js";
import { createStore } from "./store.js";
import { systemMetrics } from "./systemMetrics.js";

const VALID_EVENTS = new Set([
  "enemy_killed",
  "boss_phase",
  "powerup",
  "extra_life",
  "player_hit",
  "run_end",
  "heartbeat"
]);
const COPILOT_MODES = new Set(["live", "leaderboard", "players", "run", "demo_summary"]);
const DEFAULT_OPS_AI_RATE_LIMIT_PER_MINUTE = 30;
const DEFAULT_COACH_AI_RATE_LIMIT_PER_MINUTE = 12;
const DEFAULT_OPS_CONTROL_RATE_LIMIT_PER_MINUTE = 8;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0];
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function privateLoadBalancerName() {
  const configured = process.env.PRIVATE_LOAD_BALANCER_NAME ?? process.env.API_LOAD_BALANCER_NAME;
  if (configured) return configured;

  const publicLoadBalancer = process.env.LOAD_BALANCER_NAME;
  if (publicLoadBalancer?.endsWith("-web-lb")) {
    return publicLoadBalancer.replace(/-web-lb$/, "-api-lb");
  }

  return "private-api-lb";
}

function requireOpsAccess(req, res, next) {
  if (req.body?.ops !== true) {
    res.status(403).json({ error: "Ops access is required." });
    return;
  }

  next();
}

function createFixedWindowRateLimit({ name, windowMs = 60000, max, keyFn, message }) {
  const buckets = new Map();

  return (req, res, next) => {
    if (process.env.DISABLE_API_RATE_LIMITS === "true") {
      next();
      return;
    }

    const now = Date.now();
    const key = `${name}:${keyFn(req)}`;
    const bucket = buckets.get(key);
    const activeBucket = bucket && bucket.resetAt > now
      ? bucket
      : { count: 0, resetAt: now + windowMs };

    activeBucket.count += 1;
    buckets.set(key, activeBucket);

    if (buckets.size > 2000) {
      for (const [bucketKey, value] of buckets.entries()) {
        if (value.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    if (activeBucket.count > max) {
      res.set("Retry-After", String(Math.ceil((activeBucket.resetAt - now) / 1000)));
      res.status(429).json({ error: message ?? "Rate limit exceeded." });
      return;
    }

    next();
  };
}

function vmIdentity() {
  return {
    id: process.env.OCI_INSTANCE_ID ?? process.env.INSTANCE_ID ?? "local-instance",
    name: process.env.INSTANCE_NAME ?? process.env.HOSTNAME ?? "local-demo",
    availabilityDomain: process.env.OCI_AVAILABILITY_DOMAIN ?? "local",
    region: process.env.OCI_REGION ?? process.env.REGION ?? "local"
  };
}

async function vmStatus() {
  return {
    ...vmIdentity(),
    metrics: await systemMetrics()
  };
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (!VALID_EVENTS.has(event.type)) {
    return null;
  }

  return {
    id: randomUUID(),
    runId: String(event.runId ?? randomUUID()),
    sessionId: String(event.sessionId ?? "anonymous"),
    type: event.type,
    level: Number(event.level ?? 1),
    score: Number(event.score ?? 0),
    callsign: normalizeCallsign(event.callsign),
    wave: Number(event.wave ?? 1),
    bossActive: event.bossActive === true,
    cloudAction: String(event.cloudAction ?? "none"),
    metrics: {
      fps: Number(event.metrics?.fps ?? 0),
      latencyMs: Number(event.metrics?.latencyMs ?? 0)
    },
    clientTs: event.clientTs ?? new Date().toISOString(),
    serverTs: new Date().toISOString(),
    vm: vmIdentity()
  };
}

function normalizeCallsign(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 14)
    .toUpperCase();

  return normalized || "UNKNOWN";
}

export function createApp({
  store = createStore(),
  createInsight = createCopilotInsight,
  createCardInsights = createLeaderboardCardInsights,
  createCoach = createCoachReply,
  stressController = { start: startStress, stop: stopStress, status: stressStatus },
  streamConsumer = { status: () => ({ enabled: false, status: "disabled" }) }
} = {}) {
  const app = express();
  const opsAiRateLimit = createFixedWindowRateLimit({
    name: "ops-ai",
    max: positiveInteger(
      process.env.OPS_AI_RATE_LIMIT_PER_MINUTE,
      DEFAULT_OPS_AI_RATE_LIMIT_PER_MINUTE
    ),
    keyFn: clientIp,
    message: "Ops AI rate limit exceeded."
  });
  const opsControlRateLimit = createFixedWindowRateLimit({
    name: "ops-control",
    max: positiveInteger(
      process.env.OPS_CONTROL_RATE_LIMIT_PER_MINUTE,
      DEFAULT_OPS_CONTROL_RATE_LIMIT_PER_MINUTE
    ),
    keyFn: clientIp,
    message: "Ops control rate limit exceeded."
  });
  const coachAiRateLimit = createFixedWindowRateLimit({
    name: "coach-ai",
    max: positiveInteger(
      process.env.COACH_AI_RATE_LIMIT_PER_MINUTE,
      DEFAULT_COACH_AI_RATE_LIMIT_PER_MINUTE
    ),
    keyFn: (req) => `${clientIp(req)}:${String(req.body?.sessionId ?? "anonymous").slice(0, 80)}`,
    message: "Coach AI rate limit exceeded."
  });

  app.set("trust proxy", true);
  app.use(helmet({ crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
  app.use(express.json({ limit: "256kb" }));
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/healthz", (req, res) => {
    res.json({ ok: true, vm: vmIdentity() });
  });

  app.get("/api/status", async (req, res) => {
    res.json({
      gateway: process.env.API_GATEWAY_NAME ?? "api-gateway",
      loadBalancer: process.env.LOAD_BALANCER_NAME ?? "healthy",
      privateLoadBalancer: privateLoadBalancerName(),
      vm: await vmStatus(),
      sinks: await store.status(),
      streamConsumer: streamConsumer.status(),
      stress: stressController.status(),
      eventIngestRouteMode: process.env.EVENT_INGEST_ROUTE_MODE ?? "vm-api",
      serverTime: new Date().toISOString()
    });
  });

  app.post("/api/events", async (req, res) => {
    const input = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    const events = input.map(normalizeEvent).filter(Boolean);

    if (events.length === 0) {
      res.status(400).json({ error: "No valid telemetry events supplied." });
      return;
    }

    await store.recordEvents(events);
    res.status(202).json({ accepted: events.length });
  });

  app.get("/api/leaderboard", async (req, res) => {
    res.json({ entries: await store.leaderboard() });
  });

  app.get("/api/leaderboard/rank", async (req, res) => {
    res.json(await store.leaderboardRank({
      runId: req.query.runId,
      callsign: req.query.callsign,
      score: req.query.score
    }));
  });

  app.post("/api/leaderboard/insights", requireOpsAccess, opsAiRateLimit, async (req, res) => {
    res.json(await createCardInsights(await store.leaderboard()));
  });

  app.get("/api/players/live", async (req, res) => {
    res.json({ players: await store.livePlayers() });
  });

  app.get("/api/analytics/live", async (req, res) => {
    res.json(await store.liveAnalytics(req.query.runId));
  });

  app.get("/api/analytics/events", async (req, res) => {
    res.json(await store.eventAnalytics());
  });

  app.get("/api/stress", (req, res) => {
    res.json(stressController.status());
  });

  app.post("/api/stress", requireOpsAccess, opsControlRateLimit, (req, res) => {
    if (req.body?.action === "stop") {
      res.status(202).json(stressController.stop());
      return;
    }

    res.status(202).json(
      stressController.start({
        durationSeconds: req.body?.durationSeconds,
        workers: req.body?.workers
      })
    );
  });

  app.post("/api/copilot", requireOpsAccess, opsAiRateLimit, async (req, res) => {
    const requestedMode = String(req.body?.mode ?? "live");
    const mode = COPILOT_MODES.has(requestedMode) ? requestedMode : "live";
    const [analytics, eventAnalytics, leaderboard, cachedLivePlayers, sinks] = await Promise.all([
      store.liveAnalytics(req.body?.runId),
      store.eventAnalytics(),
      store.leaderboard(),
      store.livePlayers(),
      store.status()
    ]);
    const snapshotLivePlayers = Array.isArray(req.body?.snapshot?.activePlayers)
      ? req.body.snapshot.activePlayers
      : [];
    const livePlayers =
      cachedLivePlayers.length > 0 || mode !== "live" ? cachedLivePlayers : snapshotLivePlayers;
    const result = await createInsight({
      mode,
      question: req.body?.question,
      snapshot: req.body?.snapshot ?? {},
      analytics,
      eventAnalytics,
      leaderboard,
      livePlayers,
      sinks,
      streamConsumer: streamConsumer.status(),
      routeMode: process.env.EVENT_INGEST_ROUTE_MODE ?? "vm-api",
      vm: vmIdentity()
    });
    const insight = typeof result === "string" ? result : result.insight;
    await store.recordInsight({
      runId: req.body?.runId ?? "unknown",
      insight,
      createdAt: new Date().toISOString()
    });
    res.json(
      typeof result === "string"
        ? { insight, source: "unknown", mode }
        : { ...result, mode: result.mode ?? mode }
    );
  });

  app.post("/api/coach", coachAiRateLimit, async (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    if (message.length > 300) {
      res.status(400).json({ error: "Coach message must be 300 characters or fewer." });
      return;
    }

    const reply = await createCoach({
      runId: req.body?.runId,
      sessionId: req.body?.sessionId,
      level: req.body?.level,
      questionId: req.body?.questionId,
      message,
      attemptCount: req.body?.attemptCount
    });

    if (!reply) {
      res.status(400).json({ error: "Unknown quiz coach context." });
      return;
    }

    res.json(reply);
  });

  return app;
}
