import { archiveEventsToObjectStorage, publishEventsToStreaming } from "./ociSinks.js";
import { createRedisLivePlayers } from "./livePlayers.js";
import { randomUUID } from "node:crypto";

const MAX_EVENTS = 5000;
const SEED_LEADERBOARD = process.env.SEED_DEMO_LEADERBOARD === "true" ? [
  { callsign: "VEGA-9", score: 12400, level: 4, runId: "seed-1", vm: "seed", createdAt: new Date().toISOString() },
  { callsign: "ORACLE-1", score: 9800, level: 3, runId: "seed-2", vm: "seed", createdAt: new Date().toISOString() },
  { callsign: "PHOENIX", score: 7600, level: 3, runId: "seed-3", vm: "seed", createdAt: new Date().toISOString() }
] : [];
const EVENT_TYPES = ["enemy_killed", "player_hit", "powerup", "extra_life", "boss_phase", "run_end", "heartbeat"];

let schemaReady = false;

function scoreEntry(event) {
  return {
    callsign: event.callsign || `GRID-${event.sessionId.slice(0, 4).toUpperCase()}`,
    score: event.score,
    level: event.level,
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

async function ignoreAlreadyExists(operation) {
  try {
    await operation();
  } catch (error) {
    if (error.errorNum !== 955) {
      throw error;
    }
  }
}

async function ensureAutonomousSchema(connection) {
  if (schemaReady) {
    return;
  }

  await ignoreAlreadyExists(() =>
    connection.execute(`
      create table game_events (
        id varchar2(64) primary key,
        run_id varchar2(64) not null,
        session_id varchar2(64) not null,
        event_type varchar2(64) not null,
        level_no number not null,
        score number not null,
        cloud_action varchar2(64) not null,
        fps number,
        latency_ms number,
        client_ts timestamp with time zone,
        server_ts timestamp with time zone default systimestamp not null,
        vm_name varchar2(128),
        payload_json clob check (payload_json is json)
      )
    `)
  );
  await ignoreAlreadyExists(() => connection.execute("create index game_events_run_idx on game_events (run_id, server_ts)"));
  await ignoreAlreadyExists(() => connection.execute("create index game_events_type_idx on game_events (event_type, server_ts)"));
  await ignoreAlreadyExists(() =>
    connection.execute(`
      create table high_scores (
        run_id varchar2(64) primary key,
        session_id varchar2(64) not null,
        callsign varchar2(32) not null,
        score number not null,
        level_no number not null,
        vm_name varchar2(128),
        created_at timestamp with time zone default systimestamp not null
      )
    `)
  );
  await ignoreAlreadyExists(() => connection.execute("create index high_scores_rank_idx on high_scores (score desc, created_at asc)"));
  await ignoreAlreadyExists(() =>
    connection.execute(`
      create table ai_insights (
        id number generated always as identity primary key,
        run_id varchar2(64) not null,
        insight varchar2(500) not null,
        created_at timestamp with time zone default systimestamp not null
      )
    `)
  );
  await ignoreAlreadyExists(() =>
    connection.execute(`
      create table demo_settings (
        setting_key varchar2(64) primary key,
        setting_value varchar2(4000),
        updated_at timestamp with time zone default systimestamp not null
      )
    `)
  );
  await ignoreAlreadyExists(() =>
    connection.execute(`
      create table email_signups (
        id varchar2(64) primary key,
        callsign varchar2(32) not null,
        email varchar2(254) not null,
        created_at timestamp with time zone default systimestamp not null
      )
    `)
  );
  await ignoreAlreadyExists(() => connection.execute("create index email_signups_created_idx on email_signups (created_at desc)"));
  await ignoreAlreadyExists(() => connection.execute("create index email_signups_email_idx on email_signups (email)"));

  schemaReady = true;
}

async function oracleObjectOptions() {
  return { outFormat: (await import("oracledb")).default.OUT_FORMAT_OBJECT };
}

function toNumber(value) {
  return Number(value ?? 0);
}

function emptyEventCounts() {
  return Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]));
}

function normalizeTypeCounts(rows) {
  const counts = new Map(EVENT_TYPES.map((type) => [type, 0]));
  for (const row of rows ?? []) {
    counts.set(String(row.EVENT_TYPE), toNumber(row.EVENT_COUNT));
  }

  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => Number(right.count) - Number(left.count) || left.type.localeCompare(right.type));
}

function eventCountsByRunFromMemory(events, runIds) {
  const wanted = new Set(runIds);
  const counts = new Map(runIds.map((runId) => [runId, emptyEventCounts()]));

  for (const event of events) {
    if (!wanted.has(event.runId)) {
      continue;
    }
    const runCounts = counts.get(event.runId) ?? emptyEventCounts();
    runCounts[event.type] = toNumber(runCounts[event.type]) + 1;
    counts.set(event.runId, runCounts);
  }

  return counts;
}

function eventAnalyticsFromMemory(events) {
  const now = Date.now();
  const last1m = now - 60_000;
  const last5m = now - 300_000;
  const last15m = now - 900_000;
  const recent = events.filter((event) => Date.parse(event.serverTs) >= last15m);
  const counts = new Map(EVENT_TYPES.map((type) => [type, 0]));

  for (const event of events) {
    const eventTime = Date.parse(event.serverTs);
    if (eventTime >= last15m) {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
  }

  return {
    source: "memory",
    generatedAt: new Date().toISOString(),
    windows: {
      last1m: events.filter((event) => Date.parse(event.serverTs) >= last1m).length,
      last5m: events.filter((event) => Date.parse(event.serverTs) >= last5m).length,
      last15m: recent.length
    },
    eventTypes: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => Number(right.count) - Number(left.count) || left.type.localeCompare(right.type))
  };
}

function mergeLeaderboards(primary, fallback) {
  const entriesByRun = new Map();
  for (const entry of [...primary, ...fallback]) {
    const key = entry.runId || `${entry.callsign}-${entry.score}`;
    const existing = entriesByRun.get(key);
    if (!existing || Number(entry.score) > Number(existing.score)) {
      entriesByRun.set(key, entry);
    }
  }

  return [...entriesByRun.values()]
    .sort((left, right) => Number(right.score) - Number(left.score) || Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(0, 10);
}

export function createStore() {
  const events = [];
  const leaderboard = [...SEED_LEADERBOARD];
  const insights = [];
  const livePlayers = createRedisLivePlayers();
  const emailCollection = {
    enabled: false,
    signups: []
  };

  async function persistToAutonomousDb(batch) {
    const connection = await createOracleConnection();
    if (!connection) {
      return "disabled";
    }

    try {
      await ensureAutonomousSchema(connection);
      await connection.executeMany(
        `merge into game_events target
         using (
           select :id id, :runId run_id, :sessionId session_id, :eventType event_type,
                  :eventLevel level_no, :score score, :cloudAction cloud_action,
                  :fps fps, :latencyMs latency_ms, :clientTs client_ts,
                  :vmName vm_name, :payload payload_json
           from dual
         ) source
         on (target.id = source.id)
         when not matched then insert (
           id, run_id, session_id, event_type, level_no, score, cloud_action,
           fps, latency_ms, client_ts, server_ts, vm_name, payload_json
         ) values (
           source.id, source.run_id, source.session_id, source.event_type,
           source.level_no, source.score, source.cloud_action, source.fps,
           source.latency_ms, source.client_ts, systimestamp, source.vm_name,
           source.payload_json
         )`,
        batch.map((event) => ({
          id: event.id,
          runId: event.runId,
          sessionId: event.sessionId,
          eventType: event.type,
          eventLevel: event.level,
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

      const runEnds = batch.filter((event) => event.type === "run_end");
      if (runEnds.length > 0) {
        await connection.executeMany(
          `merge into high_scores target
           using (
             select :runId run_id, :sessionId session_id, :callsign callsign,
                    :score score, :eventLevel level_no, :vmName vm_name
             from dual
           ) source
           on (target.run_id = source.run_id)
           when matched then update set
             target.session_id = source.session_id,
             target.callsign = source.callsign,
             target.score = source.score,
             target.level_no = source.level_no,
             target.vm_name = source.vm_name
             where source.score > target.score
           when not matched then insert (
             run_id, session_id, callsign, score, level_no, vm_name
           ) values (
             source.run_id, source.session_id, source.callsign, source.score, source.level_no, source.vm_name
           )`,
          runEnds.map((event) => ({
            runId: event.runId,
            sessionId: event.sessionId,
            callsign: event.callsign || `GRID-${event.sessionId.slice(0, 4).toUpperCase()}`,
            score: event.score,
            eventLevel: event.level,
            vmName: event.vm.name
          })),
          { autoCommit: true }
        );
      }

      return "connected";
    } finally {
      await connection.close();
    }
  }

  async function leaderboardFromAutonomousDb() {
    const connection = await createOracleConnection();
    if (!connection) {
      return null;
    }

    try {
      await ensureAutonomousSchema(connection);
      const result = await connection.execute(
        `select callsign, score, run_id, level_no, vm_name,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') created_at
         from high_scores
         order by score desc, created_at asc
         fetch first 10 rows only`,
        [],
        { outFormat: (await import("oracledb")).default.OUT_FORMAT_OBJECT }
      );

      return (result.rows ?? []).map((row) => ({
        callsign: row.CALLSIGN,
        score: Number(row.SCORE),
        runId: row.RUN_ID,
        level: Number(row.LEVEL_NO),
        vm: row.VM_NAME,
        createdAt: row.CREATED_AT
      }));
    } finally {
      await connection.close();
    }
  }

  async function resetAutonomousDemoData() {
    const connection = await createOracleConnection();
    if (!connection) {
      return "disabled";
    }

    try {
      await ensureAutonomousSchema(connection);
      await connection.execute("delete from ai_insights");
      await connection.execute("delete from high_scores");
      await connection.execute("delete from game_events");
      await connection.commit();
      return "cleared";
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      await connection.close();
    }
  }

  async function readDemoSettingFromAutonomousDb(key) {
    const connection = await createOracleConnection();
    if (!connection) {
      return null;
    }

    try {
      await ensureAutonomousSchema(connection);
      const result = await connection.execute(
        `select setting_value
         from demo_settings
         where setting_key = :settingKey
         fetch first 1 rows only`,
        { settingKey: key },
        await oracleObjectOptions()
      );
      return result.rows?.[0]?.SETTING_VALUE ?? null;
    } finally {
      await connection.close();
    }
  }

  async function writeDemoSettingToAutonomousDb(key, value) {
    const connection = await createOracleConnection();
    if (!connection) {
      return "disabled";
    }

    try {
      await ensureAutonomousSchema(connection);
      await connection.execute(
        `merge into demo_settings target
         using (
           select :settingKey setting_key, :settingValue setting_value
           from dual
         ) source
         on (target.setting_key = source.setting_key)
         when matched then update set
           target.setting_value = source.setting_value,
           target.updated_at = systimestamp
         when not matched then insert (
           setting_key, setting_value
         ) values (
           source.setting_key, source.setting_value
         )`,
        { settingKey: key, settingValue: String(value) },
        { autoCommit: true }
      );
      return "connected";
    } finally {
      await connection.close();
    }
  }

  async function recordEmailSignupToAutonomousDb(entry) {
    const connection = await createOracleConnection();
    if (!connection) {
      return "disabled";
    }

    try {
      await ensureAutonomousSchema(connection);
      await connection.execute(
        `insert into email_signups (
           id, callsign, email, created_at
         ) values (
           :id, :callsign, :email, :createdAt
         )`,
        {
          id: entry.id,
          callsign: entry.callsign,
          email: entry.email,
          createdAt: new Date(entry.createdAt)
        },
        { autoCommit: true }
      );
      return "connected";
    } finally {
      await connection.close();
    }
  }

  async function emailSignupsFromAutonomousDb() {
    const connection = await createOracleConnection();
    if (!connection) {
      return null;
    }

    try {
      await ensureAutonomousSchema(connection);
      const result = await connection.execute(
        `select callsign, email,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') created_at
         from email_signups
         order by created_at desc
         fetch first 1000 rows only`,
        [],
        await oracleObjectOptions()
      );

      return (result.rows ?? []).map((row) => ({
        callsign: row.CALLSIGN,
        email: row.EMAIL,
        createdAt: row.CREATED_AT
      }));
    } finally {
      await connection.close();
    }
  }

  async function resetEmailSignupsInAutonomousDb() {
    const connection = await createOracleConnection();
    if (!connection) {
      return "disabled";
    }

    try {
      await ensureAutonomousSchema(connection);
      await connection.execute("delete from email_signups");
      await connection.commit();
      return "cleared";
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      await connection.close();
    }
  }

  async function eventAnalyticsFromAutonomousDb() {
    const connection = await createOracleConnection();
    if (!connection) {
      return null;
    }

    try {
      await ensureAutonomousSchema(connection);
      const options = await oracleObjectOptions();
      const windowResult = await connection.execute(
        `select
           sum(case when server_ts >= systimestamp - interval '1' minute then 1 else 0 end) as last_1m,
           sum(case when server_ts >= systimestamp - interval '5' minute then 1 else 0 end) as last_5m,
           count(*) as last_15m
         from game_events
         where server_ts >= systimestamp - interval '15' minute`,
        [],
        options
      );
      const typeResult = await connection.execute(
        `select event_type, count(*) as event_count
         from game_events
         where server_ts >= systimestamp - interval '15' minute
         group by event_type
         order by count(*) desc, event_type asc`,
        [],
        options
      );
      const windows = windowResult.rows?.[0] ?? {};
      return {
        source: "autonomousDatabase",
        generatedAt: new Date().toISOString(),
        windows: {
          last1m: toNumber(windows.LAST_1M),
          last5m: toNumber(windows.LAST_5M),
          last15m: toNumber(windows.LAST_15M)
        },
        eventTypes: normalizeTypeCounts(typeResult.rows)
      };
    } finally {
      await connection.close();
    }
  }

  async function eventCountsByRunFromAutonomousDb(runIds) {
    const uniqueRunIds = [...new Set(runIds.filter(Boolean))].slice(0, 20);
    if (uniqueRunIds.length === 0) {
      return new Map();
    }

    const connection = await createOracleConnection();
    if (!connection) {
      return null;
    }

    try {
      await ensureAutonomousSchema(connection);
      const options = await oracleObjectOptions();
      const binds = Object.fromEntries(uniqueRunIds.map((runId, index) => [`run${index}`, runId]));
      const placeholders = uniqueRunIds.map((_, index) => `:run${index}`).join(", ");
      const result = await connection.execute(
        `select run_id, event_type, count(*) as event_count
         from game_events
         where run_id in (${placeholders})
         group by run_id, event_type`,
        binds,
        options
      );
      const counts = new Map(uniqueRunIds.map((runId) => [runId, emptyEventCounts()]));

      for (const row of result.rows ?? []) {
        const runCounts = counts.get(row.RUN_ID) ?? emptyEventCounts();
        runCounts[row.EVENT_TYPE] = toNumber(row.EVENT_COUNT);
        counts.set(row.RUN_ID, runCounts);
      }

      return counts;
    } finally {
      await connection.close();
    }
  }

  async function addEventCountsByRun(items) {
    const runIds = items.map((item) => item.runId).filter(Boolean);
    if (runIds.length === 0) {
      return items;
    }

    let countsByRun;
    try {
      countsByRun = await eventCountsByRunFromAutonomousDb(runIds);
    } catch (error) {
      console.warn("Autonomous Database event count read failed, using memory fallback.", error.message);
    }
    if (!countsByRun) {
      countsByRun = eventCountsByRunFromMemory(events, runIds);
    }

    return items.map((item) => ({
      ...item,
      eventCounts: countsByRun.get(item.runId) ?? emptyEventCounts()
    }));
  }

  async function leaderboardRankFromAutonomousDb({ runId, callsign, score }) {
    const connection = await createOracleConnection();
    if (!connection) {
      return null;
    }

    try {
      await ensureAutonomousSchema(connection);
      const options = await oracleObjectOptions();
      let target = null;

      if (runId) {
        const targetResult = await connection.execute(
          `select callsign, score, run_id
           from high_scores
           where run_id = :runId
           fetch first 1 rows only`,
          { runId },
          options
        );
        target = targetResult.rows?.[0] ?? null;
      }

      if (!target && callsign && Number.isFinite(Number(score))) {
        const targetResult = await connection.execute(
          `select callsign, score, run_id
           from high_scores
           where upper(callsign) = upper(:callsign)
             and score = :score
           order by created_at desc
           fetch first 1 rows only`,
          { callsign, score: Number(score) },
          options
        );
        target = targetResult.rows?.[0] ?? null;
      }

      const targetWasPersisted = Boolean(target);
      const targetScore = Number(target?.SCORE ?? score);
      if (!Number.isFinite(targetScore)) {
        return null;
      }

      const rankResult = await connection.execute(
        `select count(*) + 1 as rank_no
         from high_scores
         where score > :score`,
        { score: targetScore },
        options
      );
      const totalResult = await connection.execute(
        `select count(*) as total_runs from high_scores`,
        [],
        options
      );
      const leaderResult = await connection.execute(
        `select callsign, score, run_id
         from high_scores
         order by score desc, created_at asc
         fetch first 1 rows only`,
        [],
        options
      );

      const leader = leaderResult.rows?.[0];
      const totalRuns = toNumber(totalResult.rows?.[0]?.TOTAL_RUNS);
      return {
        rank: toNumber(rankResult.rows?.[0]?.RANK_NO),
        total: targetWasPersisted ? totalRuns : totalRuns + 1,
        source: "autonomousDatabase",
        leader: leader
          ? {
              callsign: leader.CALLSIGN,
              score: Number(leader.SCORE),
              runId: leader.RUN_ID
            }
          : null
      };
    } finally {
      await connection.close();
    }
  }

  function leaderboardRankFromMemory({ runId, callsign, score }) {
    const ranked = [...leaderboard].sort(
      (left, right) => Number(right.score) - Number(left.score) || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    );
    const rankIndex = ranked.findIndex((entry) => {
      if (runId && entry.runId) {
        return entry.runId === runId;
      }
      return (
        String(entry.callsign ?? "").toUpperCase() === String(callsign ?? "").toUpperCase() &&
        Number(entry.score ?? 0) === Number(score ?? 0)
      );
    });

    if (rankIndex >= 0) {
      return {
        rank: rankIndex + 1,
        total: ranked.length,
        source: "memory",
        leader: ranked[0] ?? null
      };
    }

    const numericScore = Number(score);
    return {
      rank: Number.isFinite(numericScore)
        ? ranked.filter((entry) => Number(entry.score ?? 0) > numericScore).length + 1
        : null,
      total: Number.isFinite(numericScore) ? ranked.length + 1 : ranked.length,
      source: "memory",
      leader: ranked[0] ?? null
    };
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

      const sinkResults = await Promise.allSettled([
        livePlayers.update(batch),
        publishEventsToStreaming(batch)
      ]);
      const sinkNames = ["Redis live players", "Streaming"];
      for (const [index, result] of sinkResults.entries()) {
        if (result.status === "rejected") {
          console.warn(`${sinkNames[index]} sink failed.`, result.reason.message);
        }
      }
    },

    async persistConsumedEvents(batch) {
      const sinkResults = await Promise.allSettled([
        persistToAutonomousDb(batch),
        archiveEventsToObjectStorage(batch)
      ]);
      const sinkNames = ["Autonomous Database", "Object Storage"];
      for (const [index, result] of sinkResults.entries()) {
        if (result.status === "rejected") {
          console.warn(`${sinkNames[index]} consumer sink failed.`, result.reason.message);
        }
      }

      return Object.fromEntries(
        sinkResults.map((result, index) => [
          index === 0 ? "autonomousDatabase" : "objectStorage",
          result.status === "fulfilled" ? result.value : "failed"
        ])
      );
    },

    async leaderboard() {
      let entries;
      try {
        const persisted = await leaderboardFromAutonomousDb();
        if (persisted) {
          entries = persisted.length > 0 ? mergeLeaderboards(persisted, leaderboard) : [];
        }
      } catch (error) {
        console.warn("Autonomous Database leaderboard read failed, using memory fallback.", error.message);
      }

      return addEventCountsByRun(entries ?? leaderboard.slice(0, 10));
    },

    async leaderboardRank(target = {}) {
      try {
        const persisted = await leaderboardRankFromAutonomousDb(target);
        if (persisted) {
          return persisted;
        }
      } catch (error) {
        console.warn("Autonomous Database rank read failed, using memory fallback.", error.message);
      }

      return leaderboardRankFromMemory(target);
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

    async eventAnalytics() {
      try {
        const persisted = await eventAnalyticsFromAutonomousDb();
        if (persisted) {
          return persisted;
        }
      } catch (error) {
        console.warn("Autonomous Database event analytics read failed, using memory fallback.", error.message);
      }

      return eventAnalyticsFromMemory(events);
    },

    async recordInsight(insight) {
      insights.push(insight);
      insights.splice(0, Math.max(0, insights.length - 50));
    },

    async emailCollectionStatus() {
      try {
        const stored = await readDemoSettingFromAutonomousDb("email_collection_enabled");
        if (stored !== null) {
          emailCollection.enabled = stored === "true";
          return {
            enabled: emailCollection.enabled,
            source: "autonomousDatabase"
          };
        }
      } catch (error) {
        console.warn("Autonomous Database email collection status read failed, using memory fallback.", error.message);
      }

      return {
        enabled: emailCollection.enabled,
        source: "memory"
      };
    },

    async setEmailCollectionEnabled(enabled) {
      emailCollection.enabled = enabled === true;
      try {
        const source = await writeDemoSettingToAutonomousDb(
          "email_collection_enabled",
          emailCollection.enabled ? "true" : "false"
        );
        return {
          enabled: emailCollection.enabled,
          source: source === "connected" ? "autonomousDatabase" : "memory"
        };
      } catch (error) {
        console.warn("Autonomous Database email collection status write failed, using memory fallback.", error.message);
      }

      return {
        enabled: emailCollection.enabled,
        source: "memory"
      };
    },

    async recordEmailSignup({ callsign, email }) {
      const entry = {
        id: randomUUID(),
        callsign,
        email,
        createdAt: new Date().toISOString()
      };
      emailCollection.signups.unshift(entry);
      emailCollection.signups.splice(500);

      try {
        const source = await recordEmailSignupToAutonomousDb(entry);
        return {
          entry: { callsign: entry.callsign, email: entry.email, createdAt: entry.createdAt },
          source: source === "connected" ? "autonomousDatabase" : "memory"
        };
      } catch (error) {
        console.warn("Autonomous Database email signup write failed, using memory fallback.", error.message);
      }

      return {
        entry: { callsign: entry.callsign, email: entry.email, createdAt: entry.createdAt },
        source: "memory"
      };
    },

    async emailSignups() {
      try {
        const entries = await emailSignupsFromAutonomousDb();
        if (entries) {
          return {
            entries,
            source: "autonomousDatabase"
          };
        }
      } catch (error) {
        console.warn("Autonomous Database email signup read failed, using memory fallback.", error.message);
      }

      return {
        entries: emailCollection.signups.map((entry) => ({
          callsign: entry.callsign,
          email: entry.email,
          createdAt: entry.createdAt
        })),
        source: "memory"
      };
    },

    async resetEmailCollection() {
      emailCollection.signups.splice(0, emailCollection.signups.length);

      const autonomousResult = await resetEmailSignupsInAutonomousDb();
      return {
        memory: "cleared",
        autonomousDatabase: autonomousResult
      };
    },

    async resetDemoData() {
      events.splice(0, events.length);
      leaderboard.splice(0, leaderboard.length);
      insights.splice(0, insights.length);

      const [livePlayersResult, autonomousResult] = await Promise.allSettled([
        livePlayers.reset(),
        resetAutonomousDemoData()
      ]);

      if (autonomousResult.status === "rejected") {
        throw autonomousResult.reason;
      }

      return {
        memory: "cleared",
        redisLivePlayers: livePlayersResult.status === "fulfilled" ? livePlayersResult.value : "failed",
        autonomousDatabase: autonomousResult.value,
        objectStorage: "retained-raw-archive"
      };
    }
  };
}
