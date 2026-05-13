import { archiveEventsToObjectStorage, publishEventsToStreaming } from "./ociSinks.js";
import { createRedisLivePlayers } from "./livePlayers.js";

const MAX_EVENTS = 5000;

function scoreEntry(event) {
  return {
    callsign: event.callsign || `GRID-${event.sessionId.slice(0, 4).toUpperCase()}`,
    score: event.score,
    runId: event.runId,
    vm: event.vm.name,
    createdAt: event.serverTs
  };
}

async function createOracleConnection() {
  if (!process.env.ADB_CONNECT_STRING || !process.env.ADB_USER || !process.env.ADB_PASSWORD) {
    return null;
  }

  const oracledb = await import("oracledb");
  return oracledb.default.getConnection({
    user: process.env.ADB_USER,
    password: process.env.ADB_PASSWORD,
    connectString: process.env.ADB_CONNECT_STRING
  });
}

export function createStore() {
  const events = [];
  const leaderboard = [
    { callsign: "VEGA-9", score: 12400, runId: "seed-1", vm: "seed", createdAt: new Date().toISOString() },
    { callsign: "ORACLE-1", score: 9800, runId: "seed-2", vm: "seed", createdAt: new Date().toISOString() },
    { callsign: "PHOENIX", score: 7600, runId: "seed-3", vm: "seed", createdAt: new Date().toISOString() }
  ];
  const insights = [];
  const livePlayers = createRedisLivePlayers();

  async function persistToAutonomousDb(batch) {
    const connection = await createOracleConnection();
    if (!connection) {
      return "disabled";
    }

    try {
      await connection.executeMany(
        `insert into game_events (
          id, run_id, session_id, event_type, level_no, score, cloud_action,
          fps, latency_ms, client_ts, server_ts, vm_name, payload_json
        ) values (
          :id, :runId, :sessionId, :type, :level, :score, :cloudAction,
          :fps, :latencyMs, :clientTs, systimestamp, :vmName, :payload
        )`,
        batch.map((event) => ({
          id: event.id,
          runId: event.runId,
          sessionId: event.sessionId,
          type: event.type,
          level: event.level,
          score: event.score,
          cloudAction: event.cloudAction,
          fps: event.metrics.fps,
          latencyMs: event.metrics.latencyMs,
          clientTs: new Date(event.clientTs),
          vmName: event.vm.name,
          payload: JSON.stringify(event)
        })),
        { autoCommit: true }
      );
      return "connected";
    } finally {
      await connection.close();
    }
  }

  return {
    async status() {
      return {
        memory: "enabled",
        autonomousDatabase: process.env.ADB_CONNECT_STRING ? "configured" : "disabled",
        streaming: process.env.OCI_STREAM_OCID ? "configured" : "disabled",
        objectStorage: process.env.OCI_BUCKET_NAME ? "configured" : "disabled",
        redisLivePlayers: await livePlayers.status()
      };
    },

    async recordEvents(batch) {
      events.push(...batch);
      while (events.length > MAX_EVENTS) {
        events.shift();
      }

      for (const event of batch) {
        if (event.type === "run_end") {
          leaderboard.push(scoreEntry(event));
        }
      }
      leaderboard.sort((a, b) => b.score - a.score);
      leaderboard.splice(20);

      try {
        await Promise.all([
          livePlayers.update(batch),
          persistToAutonomousDb(batch),
          publishEventsToStreaming(batch),
          archiveEventsToObjectStorage(batch)
        ]);
      } catch (error) {
        console.warn("One or more OCI sinks failed.", error.message);
      }
    },

    async leaderboard() {
      return leaderboard.slice(0, 10);
    },

    async livePlayers() {
      return livePlayers.list();
    },

    async liveAnalytics(runId) {
      const cutoff = Date.now() - 30000;
      const scoped = events.filter((event) => {
        const inRun = !runId || event.runId === runId;
        return inRun && new Date(event.serverTs).getTime() >= cutoff;
      });
      const actions = scoped.reduce((accumulator, event) => {
        accumulator[event.cloudAction] = (accumulator[event.cloudAction] ?? 0) + 1;
        return accumulator;
      }, {});

      return {
        runId: runId ?? "all",
        eventsPerSecond: scoped.length / 30,
        totalRecentEvents: scoped.length,
        actions,
        latestInsight: insights.at(-1)?.insight ?? null
      };
    },

    async recordInsight(insight) {
      insights.push(insight);
      insights.splice(0, Math.max(0, insights.length - 50));
    }
  };
}
