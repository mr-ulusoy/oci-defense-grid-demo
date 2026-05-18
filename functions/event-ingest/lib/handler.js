import { randomUUID } from "node:crypto";

const VALID_EVENTS = new Set(["enemy_killed", "boss_phase", "powerup", "extra_life", "player_hit", "run_end", "heartbeat"]);

function httpGatewayContext(ctx) {
  return ctx?.httpGateway ?? ctx?.protocol ?? null;
}

function requestPath(ctx) {
  const http = httpGatewayContext(ctx);
  const candidates = [
    http?.path,
    http?.requestPath,
    http?.requestUri,
    http?.requestURI,
    http?.requestUrl,
    http?.requestURL,
    ctx?.path
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return new globalThis.URL(String(candidate), "https://function.local").pathname;
    } catch {
      const path = String(candidate).split("?")[0];
      if (path.startsWith("/")) {
        return path;
      }
    }
  }

  return "/api/events";
}

function queryParam(ctx, key) {
  const http = httpGatewayContext(ctx);
  const containers = [http?.queryParameters, http?.query, ctx?.queryParameters, ctx?.query].filter(Boolean);
  for (const container of containers) {
    const value = container[key];
    if (value != null) {
      return Array.isArray(value) ? value[0] : value;
    }
  }

  const candidates = [http?.requestUrl, http?.requestURL, http?.requestUri, http?.requestURI, ctx?.url].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return new globalThis.URL(String(candidate), "https://function.local").searchParams.get(key);
    } catch {
      // Ignore malformed URLs from local tests or platform variants.
    }
  }

  return null;
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
  const readApi = typeof recordEvents === "function" ? { recordEvents } : (recordEvents ?? {});
  const writeEvents =
    readApi.recordEvents ??
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

    const method = String(http?.method ?? "POST").toUpperCase();
    const path = requestPath(ctx);

    if (method === "GET") {
      try {
        if (path === "/api/leaderboard") {
          return { entries: (await readApi.leaderboard?.()) ?? [] };
        }
        if (path === "/api/players/live") {
          return { players: (await readApi.livePlayers?.()) ?? [] };
        }
        if (path === "/api/analytics/live") {
          return (await readApi.liveAnalytics?.(queryParam(ctx, "runId"))) ?? {
            runId: queryParam(ctx, "runId") ?? "all",
            eventsPerSecond: 0,
            totalRecentEvents: 0,
            actions: {},
            latestInsight: null
          };
        }
        if (path === "/api/analytics/events") {
          return (await readApi.eventAnalytics?.()) ?? {
            source: "function",
            windows: { last1m: 0, last5m: 0, last15m: 0 },
            eventTypes: []
          };
        }
      } catch (error) {
        console.warn(`Function read route failed for ${path}.`, error.message);
        setStatus(http, 500);
        return { error: "Function read route failed." };
      }

      setStatus(http, 404);
      return { error: "Unknown function route." };
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
