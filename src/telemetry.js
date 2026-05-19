const DEFAULT_CONFIG = {
  apiBase: "/api",
  telemetryIntervalMs: 1400,
  copilotIntervalMs: 12000,
  copilotAutoEnabled: false,
  copilotEnabled: false
};

const EVENT_TYPES = new Set([
  "enemy_killed",
  "boss_phase",
  "powerup",
  "extra_life",
  "player_hit",
  "run_end",
  "heartbeat"
]);

function uuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return response.json();
}

export class OciTelemetry {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.runId = uuid();
    this.sessionId = uuid();
    this.pending = [];
    this.recentEvents = [];
    this.status = null;
    this.offline = false;
    this.lastLatencyMs = 0;
    this.lastCopilotAt = 0;
  }

  get apiBase() {
    return this.config.apiBase.replace(/\/$/, "");
  }

  async init() {
    await this.refreshStatus();
    await this.refreshLeaderboard();
  }

  eventRate() {
    const cutoff = Date.now() - 10000;
    this.recentEvents = this.recentEvents.filter((event) => event.ts >= cutoff);
    return this.recentEvents.length / 10;
  }

  async emit(type, payload = {}) {
    if (!EVENT_TYPES.has(type)) {
      return;
    }

    const event = {
      runId: this.runId,
      sessionId: this.sessionId,
      type,
      level: payload.level ?? 1,
      score: payload.score ?? 0,
      callsign: payload.callsign ?? localStorage.getItem("playerCallsign") ?? "UNKNOWN",
      cloudAction: payload.cloudAction ?? "none",
      metrics: {
        fps: Math.round(payload.fps ?? 60),
        latencyMs: Math.round(this.lastLatencyMs || payload.latencyMs || 0)
      },
      clientTs: nowIso()
    };

    this.recentEvents.push({ ts: Date.now(), type });
    this.pending.push(event);

    if (this.pending.length >= 4 || type === "run_end") {
      await this.flush();
    }
  }

  async flush() {
    if (this.pending.length === 0) {
      return;
    }

    const events = this.pending.splice(0, this.pending.length);
    const started = performance.now();

    try {
      const response = await fetch(`${this.apiBase}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events })
      });
      await readJson(response);
      this.lastLatencyMs = performance.now() - started;
      this.offline = false;
    } catch {
      this.pending.unshift(...events.slice(-20));
      this.offline = true;
    }
  }

  async refreshStatus() {
    const started = performance.now();
    try {
      this.status = await fetch(`${this.apiBase}/status`).then(readJson);
      this.lastLatencyMs = performance.now() - started;
      this.offline = false;
    } catch {
      this.offline = true;
      this.status = {
        gateway: "offline fallback",
        loadBalancer: "local",
        vm: {
          name: "browser-demo",
          availabilityDomain: "local"
        }
      };
    }
    return this.status;
  }

  async refreshLeaderboard() {
    try {
      const result = await fetch(`${this.apiBase}/leaderboard`).then(readJson);
      this.offline = false;
      return result.entries ?? [];
    } catch {
      this.offline = true;
      return [
        { callsign: "VEGA-9", score: 12400 },
        { callsign: "PHOENIX", score: 9800 },
        { callsign: "ORACLE-1", score: 7600 }
      ];
    }
  }

  async refreshLeaderboardInsights() {
    const requestInsights = (url) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: true })
      }).then(readJson);

    try {
      const result = await requestInsights(`${this.apiBase}/leaderboard/insights`);
      this.offline = false;
      return result;
    } catch {
      // The deployed API Gateway can lag behind new demo-only routes. Keep the
      // ops UI live by falling back to the same-origin Load Balancer API.
      try {
        const result = await requestInsights("/api/leaderboard/insights");
        this.offline = false;
        return result;
      } catch {
        this.offline = true;
        return {
          cards: [],
          source: "fallback",
          model: "browser",
          modelLabel: "Browser fallback"
        };
      }
    }
  }

  async refreshLivePlayers() {
    try {
      const result = await fetch(`${this.apiBase}/players/live`).then(readJson);
      this.offline = false;
      return result.players ?? [];
    } catch {
      this.offline = true;
      return [];
    }
  }

  async analytics() {
    try {
      return await fetch(`${this.apiBase}/analytics/live?runId=${this.runId}`).then(readJson);
    } catch {
      return {
        runId: this.runId,
        eventsPerSecond: this.eventRate(),
        actions: { none: 1 },
        status: "offline"
      };
    }
  }

  async eventAnalytics() {
    try {
      return await fetch(`${this.apiBase}/analytics/events`).then(readJson);
    } catch {
      const eventsPerSecond = this.eventRate();
      return {
        source: "browser",
        generatedAt: new Date().toISOString(),
        windows: {
          last1m: eventsPerSecond * 60,
          last5m: eventsPerSecond * 300,
          last15m: eventsPerSecond * 900
        },
        eventTypes: []
      };
    }
  }

  async startStress({ durationSeconds = 260, workers = 2, fanout = 8 } = {}) {
    const payload = {
      ops: true,
      durationSeconds,
      workers
    };
    const requests = Array.from({ length: fanout }, () =>
      fetch(`${this.apiBase}/stress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(readJson)
    );
    const results = await Promise.allSettled(requests);
    const started = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (started.length === 0) {
      throw new Error("Stress request failed.");
    }

    this.offline = false;
    return {
      requested: fanout,
      accepted: started.length,
      jobs: started
    };
  }

  async stopStress({ fanout = 12 } = {}) {
    const payload = {
      ops: true,
      action: "stop"
    };
    const requests = Array.from({ length: fanout }, () =>
      fetch(`${this.apiBase}/stress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(readJson)
    );
    const results = await Promise.allSettled(requests);
    const stopped = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (stopped.length === 0) {
      throw new Error("Scale-down request failed.");
    }

    this.offline = false;
    return {
      requested: fanout,
      accepted: stopped.length,
      jobs: stopped
    };
  }

  async askCopilot(snapshot, options = {}) {
    if (!this.config.copilotEnabled) {
      return {
        insight: "Copilot is available in ops view only.",
        source: "disabled",
        mode: options.mode ?? "live"
      };
    }

    const payload = {
      runId: this.runId,
      sessionId: this.sessionId,
      ops: true,
      snapshot,
      mode: options.mode ?? "live",
      question: options.question
    };

    try {
      const result = await fetch(`${this.apiBase}/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(readJson);
      this.offline = false;
      this.lastCopilotAt = Date.now();
      return result;
    } catch {
      this.offline = true;
      return {
        insight: "Local fallback: traffic pressure is stable. Keep shields ready for the next anomaly wave.",
        source: "local-fallback",
        model: "browser",
        mode: options.mode ?? "live"
      };
    }
  }

  async askCoach({ level, questionId, message, attemptCount = 0 }) {
    const payload = {
      runId: this.runId,
      sessionId: this.sessionId,
      level,
      questionId,
      message: String(message ?? "").slice(0, 300),
      attemptCount
    };

    try {
      const result = await fetch(`${this.apiBase}/coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(readJson);
      this.offline = false;
      return result;
    } catch {
      this.offline = true;
      return {
        questionId,
        reply: "Local fallback: reread the mission briefing and focus on what each OCI service does in the flow.",
        source: "fallback"
      };
    }
  }
}
