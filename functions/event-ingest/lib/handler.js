import { randomUUID } from "node:crypto";

const VALID_EVENTS = new Set(["enemy_killed", "boss_phase", "powerup", "player_hit", "run_end", "heartbeat"]);

function httpGatewayContext(ctx) {
  return ctx?.httpGateway ?? ctx?.protocol ?? null;
}

function setJsonResponse(http) {
  http?.setResponseHeader?.("Content-Type", "application/json");
  http?.setHeader?.("Content-Type", "application/json");
}

function setStatus(http, statusCode) {
  if (http) {
    http.statusCode = statusCode;
  }
}

export function functionIdentity() {
  return {
    id: process.env.FN_FN_ID ?? "oci-function",
    name: process.env.FN_FN_NAME ?? "event-ingest",
    availabilityDomain: "serverless",
    region: process.env.OCI_RESOURCE_PRINCIPAL_REGION ?? process.env.OCI_REGION ?? process.env.REGION ?? "unknown"
  };
}

export function normalizeCallsign(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 14)
    .toUpperCase();

  return normalized || "UNKNOWN";
}

export function parsePayload(input, ctx) {
  if (input && typeof input === "object" && Object.keys(input).length > 0) {
    return input;
  }

  const rawBody = ctx?.body;
  if (Buffer.isBuffer(rawBody)) {
    return JSON.parse(rawBody.toString("utf8"));
  }
  if (typeof rawBody === "string" && rawBody.trim() !== "") {
    return JSON.parse(rawBody);
  }

  return input;
}

function payloadEvents(payload) {
  if (Array.isArray(payload?.events)) {
    return payload.events;
  }
  if (payload && typeof payload === "object") {
    return [payload];
  }
  return [];
}

export function normalizeEvent(event, vm = functionIdentity()) {
  if (!event || typeof event !== "object" || !VALID_EVENTS.has(event.type)) {
    return null;
  }

  const serverTs = new Date().toISOString();
  const sessionId = String(event.sessionId ?? "anonymous");

  return {
    id: randomUUID(),
    runId: String(event.runId ?? randomUUID()),
    sessionId,
    type: event.type,
    level: Number(event.level ?? 1),
    score: Number(event.score ?? 0),
    callsign: normalizeCallsign(event.callsign),
    cloudAction: String(event.cloudAction ?? "none"),
    metrics: {
      fps: Number(event.metrics?.fps ?? 0),
      latencyMs: Number(event.metrics?.latencyMs ?? 0)
    },
    clientTs: event.clientTs ?? serverTs,
    serverTs,
    vm
  };
}

export function createIngestHandler({ recordEvents, identity = functionIdentity } = {}) {
  const writeEvents =
    recordEvents ??
    (async () => ({
      memory: "enabled"
    }));

  return async function ingest(input, ctx = {}) {
    const http = httpGatewayContext(ctx);
    setJsonResponse(http);

    if (http?.method === "OPTIONS") {
      setStatus(http, 204);
      return {};
    }

    let payload;
    try {
      payload = parsePayload(input, ctx);
    } catch {
      setStatus(http, 400);
      return { error: "Invalid JSON telemetry payload." };
    }

    const vm = identity();
    const events = payloadEvents(payload).map((event) => normalizeEvent(event, vm)).filter(Boolean);

    if (events.length === 0) {
      setStatus(http, 400);
      return { error: "No valid telemetry events supplied." };
    }

    const sinks = await writeEvents(events);
    setStatus(http, 202);

    return {
      accepted: events.length,
      ingest: "oci-functions",
      sinks
    };
  };
}
