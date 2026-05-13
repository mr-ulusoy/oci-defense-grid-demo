import { randomUUID } from "node:crypto";

const DEFAULT_TTL_SECONDS = 60;
const EVENT_WINDOW_MS = 10000;
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

async function persistToAutonomousDb(batch) {
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

async function archiveEventsToObjectStorage(batch) {
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
        persistToAutonomousDb(batch),
        publishEventsToStreaming(batch),
        archiveEventsToObjectStorage(batch)
      ]);
      const sinkNames = ["redisLivePlayers", "autonomousDatabase", "streaming", "objectStorage"];
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

      return statuses;
    }
  };
}
