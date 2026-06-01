import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
const DEMO_RESET_CONFIRMATION_CODE = "!Oracle#2026!";
const OPS_SESSION_COOKIE = "oci_ops_session";
const DEFAULT_OPS_ADMIN_PASSWORD = "OCI2026";
const DEFAULT_OPS_SESSION_TTL_MINUTES = 480;
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

function opsAdminPassword() {
  return process.env.OPS_ADMIN_PASSWORD || DEFAULT_OPS_ADMIN_PASSWORD;
}

function opsSessionSecret() {
  return process.env.OPS_SESSION_SECRET || opsAdminPassword();
}

function opsSessionTtlMs() {
  return positiveInteger(process.env.OPS_SESSION_TTL_MINUTES, DEFAULT_OPS_SESSION_TTL_MINUTES) * 60_000;
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signOpsPayload(payload) {
  return createHmac("sha256", opsSessionSecret()).update(payload).digest("base64url");
}

function createOpsSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    role: "ops",
    exp: Date.now() + opsSessionTtlMs(),
    nonce: randomUUID()
  })).toString("base64url");
  return `${payload}.${signOpsPayload(payload)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        const name = separator >= 0 ? part.slice(0, separator) : part;
        const value = separator >= 0 ? part.slice(separator + 1) : "";
        try {
          return [name, decodeURIComponent(value)];
        } catch {
          return [name, value];
        }
      })
  );
}

function verifyOpsSessionToken(token) {
  const [payload, signature] = String(token ?? "").split(".");
  if (!payload || !signature || !safeStringEqual(signature, signOpsPayload(payload))) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.role === "ops" && Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function hasOpsSession(req) {
  return verifyOpsSessionToken(parseCookies(req)[OPS_SESSION_COOKIE]);
}

function opsCookieSecure(req) {
  if (process.env.OPS_COOKIE_SECURE === "true") return true;
  if (process.env.OPS_COOKIE_SECURE === "false") return false;
  return Boolean(req.secure);
}

function setOpsSessionCookie(req, res) {
  const cookie = [
    `${OPS_SESSION_COOKIE}=${encodeURIComponent(createOpsSessionToken())}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(opsSessionTtlMs() / 1000)}`
  ];
  if (opsCookieSecure(req)) {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearOpsSessionCookie(res) {
  res.setHeader("Set-Cookie", `${OPS_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function requireOpsAccess(req, res, next) {
  if (!hasOpsSession(req)) {
    res.status(401).json({ error: "Ops login is required." });
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

  app.get("/api/ops/session", (req, res) => {
    res.json({ authenticated: hasOpsSession(req) });
  });

  app.post("/api/ops/login", opsControlRateLimit, (req, res) => {
    if (!safeStringEqual(req.body?.password ?? "", opsAdminPassword())) {
      res.status(401).json({ error: "Invalid ops password." });
      return;
    }

    setOpsSessionCookie(req, res);
    res.json({ authenticated: true });
  });

  app.post("/api/ops/logout", (req, res) => {
    clearOpsSessionCookie(res);
    res.json({ authenticated: false });
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

  app.get("/api/players/live", requireOpsAccess, async (req, res) => {
    res.json({ players: await store.livePlayers() });
  });

  app.get("/api/analytics/live", requireOpsAccess, async (req, res) => {
    res.json(await store.liveAnalytics(req.query.runId));
  });

  app.get("/api/analytics/events", requireOpsAccess, async (req, res) => {
    res.json(await store.eventAnalytics());
  });

  app.get("/api/stress", requireOpsAccess, (req, res) => {
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

  app.post("/api/admin/reset-demo", requireOpsAccess, opsControlRateLimit, async (req, res) => {
    if (String(req.body?.confirmationCode ?? "") !== DEMO_RESET_CONFIRMATION_CODE) {
      res.status(403).json({ error: "Invalid reset confirmation code." });
      return;
    }

    try {
      const reset = await store.resetDemoData();
      res.status(202).json({
        ok: true,
        reset,
        resetAt: new Date().toISOString()
      });
    } catch (error) {
      console.warn("Full demo reset failed.", error.message);
      res.status(500).json({ error: "Full demo reset failed." });
    }
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
