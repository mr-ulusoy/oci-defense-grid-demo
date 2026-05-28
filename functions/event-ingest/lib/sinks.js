import { randomUUID } from "node:crypto";

const DEFAULT_TTL_SECONDS = 60;
const EVENT_WINDOW_MS = 10000;
const EVENT_TYPES = ["enemy_killed", "player_hit", "powerup", "extra_life", "boss_phase", "run_end", "heartbeat"];
let providerPromise;
let streamClientPromise;
let objectClientPromise;
let redisClientPromise;
let schemaReady = false;

function ttlSeconds() {
  return Number(process.env.LIVE_PLAYER_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
}

function redisConfigured() {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

function redisPrefix() {
  return process.env.REDIS_KEY_PREFIX || "oci-defense";
}

function playerKey(sessionId) {
  return `${redisPrefix()}:player:${sessionId}`;
}

function playerEventsKey(sessionId) {
  return `${redisPrefix()}:player-events:${sessionId}`;
}

function playerIndexKey() {
  return `${redisPrefix()}:players`;
}

function parseSnapshot(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function redisSocketOptions() {
  return {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6379),
    tls: process.env.REDIS_TLS !== "false",
    reconnectStrategy(retries) {
      return Math.min(50 * retries, 1000);
    }
  };
}

function playerSnapshot(event) {
  return {
    sessionId: event.sessionId,
    runId: event.runId,
    callsign: event.callsign || "UNKNOWN",
    score: Number(event.score ?? 0),
    level: Number(event.level ?? 1),
    latencyMs: Number(event.metrics?.latencyMs ?? 0),
    fps: Number(event.metrics?.fps ?? 0),
    cloudAction: event.cloudAction ?? "none",
    eventType: event.type,
    vm: event.vm?.name ?? "oci-function",
    region: event.vm?.region ?? process.env.OCI_REGION ?? "unknown",
    lastSeen: event.serverTs ?? new Date().toISOString()
  };
}

async function getAuthProvider() {
  if (!providerPromise) {
    providerPromise = (async () => {
      const common = await import("oci-common");

      if (process.env.OCI_RESOURCE_PRINCIPAL_VERSION) {
        return common.ResourcePrincipalAuthenticationDetailsProvider.builder();
      }

      return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    })();
  }

  return providerPromise;
}

async function getStreamClient() {
  if (!process.env.OCI_STREAM_OCID || !process.env.OCI_STREAM_MESSAGE_ENDPOINT) {
    return null;
  }

  if (!streamClientPromise) {
    streamClientPromise = (async () => {
      const streaming = await import("oci-streaming");
      const client = new streaming.StreamClient({
        authenticationDetailsProvider: await getAuthProvider()
      });
      client.endpoint = process.env.OCI_STREAM_MESSAGE_ENDPOINT;
      return client;
    })();
  }

  return streamClientPromise;
}

async function getObjectClient() {
  if (!process.env.OCI_NAMESPACE || !process.env.OCI_BUCKET_NAME) {
    return null;
  }

  if (!objectClientPromise) {
    objectClientPromise = (async () => {
      const objectstorage = await import("oci-objectstorage");
      return new objectstorage.ObjectStorageClient({
        authenticationDetailsProvider: await getAuthProvider()
      });
    })();
  }

  return objectClientPromise;
}

async function getRedisClient() {
  if (!redisConfigured()) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const { createClient } = await import("redis");
      const options = process.env.REDIS_URL
        ? { url: process.env.REDIS_URL }
        : {
            socket: redisSocketOptions(),
            username: process.env.REDIS_USERNAME || undefined,
            password: process.env.REDIS_PASSWORD || undefined
          };
      const client = createClient(options);
      client.on("error", (error) => {
        console.warn("Redis live player cache error.", error.message);
      });
      await client.connect();
      return client;
    })();
  }

  return redisClientPromise;
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

  schemaReady = true;
}

async function updateRedisLivePlayers(batch) {
  const client = await getRedisClient();
  if (!client) {
    return "disabled";
  }

  const ttl = ttlSeconds();
  const cutoff = Date.now() - ttl * 1000;
  const eventCutoff = Date.now() - EVENT_WINDOW_MS;
  const multi = client.multi();

  for (const event of batch) {
    const snapshot = playerSnapshot(event);
    const seen = Date.parse(snapshot.lastSeen);
    multi.set(playerKey(snapshot.sessionId), JSON.stringify(snapshot), { EX: ttl });
    multi.zAdd(playerIndexKey(), [{ score: seen, value: snapshot.sessionId }]);
    multi.zAdd(playerEventsKey(snapshot.sessionId), [{ score: seen, value: `${seen}:${event.id}` }]);
    multi.zRemRangeByScore(playerEventsKey(snapshot.sessionId), 0, eventCutoff);
    multi.expire(playerEventsKey(snapshot.sessionId), ttl);
  }

  multi.zRemRangeByScore(playerIndexKey(), 0, cutoff);
  await multi.exec();
  return "connected";
}

async function listRedisLivePlayers() {
  const client = await getRedisClient();
  if (!client) {
    return [];
  }

  const ttl = ttlSeconds();
  const cutoff = Date.now() - ttl * 1000;
  await client.zRemRangeByScore(playerIndexKey(), 0, cutoff);

  const sessionIds = await client.zRangeByScore(playerIndexKey(), cutoff, "+inf");
  if (sessionIds.length === 0) {
    return [];
  }

  const snapshots = (await client.mGet(sessionIds.map(playerKey))).map(parseSnapshot).filter(Boolean);
  const eventCounts = await Promise.all(
    snapshots.map((player) => client.zCount(playerEventsKey(player.sessionId), Date.now() - EVENT_WINDOW_MS, "+inf"))
  );

  return snapshots
    .map((player, index) => ({
      ...player,
      eventsPerSecond: Number((eventCounts[index] / 10).toFixed(1))
    }))
    .sort((left, right) => right.score - left.score || Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
}

async function eventCountsByRunFromAutonomousDb(runIds) {
  const uniqueRunIds = [...new Set(runIds.filter(Boolean))].slice(0, 20);
  if (uniqueRunIds.length === 0) {
    return new Map();
  }

  const connection = await createOracleConnection();
  if (!connection) {
    return new Map(uniqueRunIds.map((runId) => [runId, emptyEventCounts()]));
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
  const countsByRun = await eventCountsByRunFromAutonomousDb(runIds);

  return items.map((item) => ({
    ...item,
    eventCounts: countsByRun.get(item.runId) ?? emptyEventCounts()
  }));
}

async function leaderboardFromAutonomousDb() {
  const connection = await createOracleConnection();
  if (!connection) {
    return [];
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
      await oracleObjectOptions()
    );

    return addEventCountsByRun(
      (result.rows ?? []).map((row) => ({
        callsign: row.CALLSIGN,
        score: Number(row.SCORE),
        runId: row.RUN_ID,
        level: Number(row.LEVEL_NO),
        vm: row.VM_NAME,
        createdAt: row.CREATED_AT
      }))
    );
  } finally {
    await connection.close();
  }
}

async function leaderboardRankFromAutonomousDb({ runId, callsign, score } = {}) {
  const connection = await createOracleConnection();
  if (!connection) {
    const entries = await leaderboardFromAutonomousDb();
    const numericScore = Number(score);
    return {
      rank: Number.isFinite(numericScore)
        ? entries.filter((entry) => Number(entry.score ?? 0) > numericScore).length + 1
        : null,
      total: Number.isFinite(numericScore) ? entries.length + 1 : entries.length,
      source: "functionMemoryFallback",
      leader: entries[0] ?? null
    };
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
      return { rank: null, total: 0, source: "autonomousDatabase", leader: null };
    }

    const rankResult = await connection.execute(
      `select count(*) + 1 as rank_no
       from high_scores
       where score > :score`,
      { score: targetScore },
      options
    );
    const totalResult = await connection.execute("select count(*) as total_runs from high_scores", [], options);
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

async function liveAnalyticsFromAutonomousDb(runId) {
  const connection = await createOracleConnection();
  if (!connection) {
    return {
      source: "disabled",
      runId: runId ?? "all",
      eventsPerSecond: 0,
      totalRecentEvents: 0,
      actions: {},
      latestInsight: null
    };
  }

  try {
    await ensureAutonomousSchema(connection);
    const options = await oracleObjectOptions();
    const scopedRun = runId ? "and run_id = :runId" : "";
    const binds = runId ? { runId } : {};
    const totalResult = await connection.execute(
      `select count(*) as total_recent_events
       from game_events
       where server_ts >= systimestamp - interval '30' second ${scopedRun}`,
      binds,
      options
    );
    const actionResult = await connection.execute(
      `select cloud_action, count(*) as action_count
       from game_events
       where server_ts >= systimestamp - interval '30' second ${scopedRun}
       group by cloud_action`,
      binds,
      options
    );
    const total = toNumber(totalResult.rows?.[0]?.TOTAL_RECENT_EVENTS);
    const actions = Object.fromEntries(
      (actionResult.rows ?? []).map((row) => [row.CLOUD_ACTION, toNumber(row.ACTION_COUNT)])
    );

    return {
      source: "autonomousDatabase",
      runId: runId ?? "all",
      eventsPerSecond: total / 30,
      totalRecentEvents: total,
      actions,
      latestInsight: null
    };
  } finally {
    await connection.close();
  }
}

async function eventAnalyticsFromAutonomousDb() {
  const connection = await createOracleConnection();
  if (!connection) {
    return {
      source: "disabled",
      generatedAt: new Date().toISOString(),
      windows: { last1m: 0, last5m: 0, last15m: 0 },
      eventTypes: normalizeTypeCounts([])
    };
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

export async function persistToAutonomousDb(batch) {
  const connection = await createOracleConnection();
  if (!connection) {
    return "disabled";
  }

  try {
    await ensureAutonomousSchema(connection);
    await connection.executeMany(
      `insert into game_events (
        id, run_id, session_id, event_type, level_no, score, cloud_action,
        fps, latency_ms, client_ts, server_ts, vm_name, payload_json
      ) values (
        :id, :runId, :sessionId, :eventType, :eventLevel, :score, :cloudAction,
        :fps, :latencyMs, :clientTs, systimestamp, :vmName, :payload
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

async function publishEventsToStreaming(batch) {
  const client = await getStreamClient();
  if (!client) {
    return "disabled";
  }

  const messages = batch.map((event) => ({
    key: Buffer.from(event.runId).toString("base64"),
    value: Buffer.from(JSON.stringify(event)).toString("base64")
  }));

  await client.putMessages({
    streamId: process.env.OCI_STREAM_OCID,
    putMessagesDetails: { messages }
  });

  return "connected";
}

export async function archiveEventsToObjectStorage(batch) {
  const client = await getObjectClient();
  if (!client) {
    return "disabled";
  }

  const datePath = new Date().toISOString().slice(0, 10);
  const objectName = `events/${datePath}/${Date.now()}-${randomUUID()}.ndjson`;
  const payload = Buffer.from(`${batch.map((event) => JSON.stringify(event)).join("\n")}\n`);

  await client.putObject({
    namespaceName: process.env.OCI_NAMESPACE,
    bucketName: process.env.OCI_BUCKET_NAME,
    objectName,
    putObjectBody: payload,
    contentLength: payload.length,
    contentType: "application/x-ndjson"
  });

  return "connected";
}

export function createIngestSinks() {
  return {
    async recordEvents(batch) {
      const sinkResults = await Promise.allSettled([
        updateRedisLivePlayers(batch),
        publishEventsToStreaming(batch)
      ]);
      const sinkNames = ["redisLivePlayers", "streaming"];
      const statuses = {};

      for (const [index, result] of sinkResults.entries()) {
        const name = sinkNames[index];
        if (result.status === "rejected") {
          statuses[name] = "failed";
          console.warn(`${name} sink failed.`, result.reason.message);
        } else {
          statuses[name] = result.value;
        }
      }

      statuses.autonomousDatabase = statuses.streaming === "connected" ? "via-stream-consumer" : "waiting-for-stream";
      statuses.objectStorage = statuses.streaming === "connected" ? "via-stream-consumer" : "waiting-for-stream";

      return statuses;
    },

    async leaderboard() {
      return leaderboardFromAutonomousDb();
    },

    async leaderboardRank(target = {}) {
      return leaderboardRankFromAutonomousDb(target);
    },

    async livePlayers() {
      return addEventCountsByRun(await listRedisLivePlayers());
    },

    async liveAnalytics(runId) {
      return liveAnalyticsFromAutonomousDb(runId);
    },

    async eventAnalytics() {
      return eventAnalyticsFromAutonomousDb();
    }
  };
}
