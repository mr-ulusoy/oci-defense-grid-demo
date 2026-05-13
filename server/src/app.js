import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import { createCopilotInsight } from "./copilot.js";
import { createStore } from "./store.js";
import { systemMetrics } from "./systemMetrics.js";

const VALID_EVENTS = new Set([
  "enemy_killed",
  "boss_phase",
  "powerup",
  "player_hit",
  "run_end",
  "heartbeat"
]);

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

export function createApp({ store = createStore(), createInsight = createCopilotInsight } = {}) {
  const app = express();

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
      vm: await vmStatus(),
      sinks: await store.status(),
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

  app.get("/api/players/live", async (req, res) => {
    res.json({ players: await store.livePlayers() });
  });

  app.get("/api/analytics/live", async (req, res) => {
    res.json(await store.liveAnalytics(req.query.runId));
  });

  app.post("/api/copilot", async (req, res) => {
    if (req.body?.ops !== true) {
      res.status(403).json({ error: "Copilot is available in ops view only." });
      return;
    }

    const insight = await createInsight({
      snapshot: req.body?.snapshot ?? {},
      analytics: await store.liveAnalytics(req.body?.runId),
      vm: vmIdentity()
    });
    await store.recordInsight({
      runId: req.body?.runId ?? "unknown",
      insight,
      createdAt: new Date().toISOString()
    });
    res.json({ insight });
  });

  return app;
}
