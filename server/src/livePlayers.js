const DEFAULT_TTL_SECONDS = 60;
const EVENT_WINDOW_MS = 10000;
const EVENT_TYPES = ["enemy_killed", "player_hit", "powerup", "extra_life", "boss_phase", "run_end", "heartbeat"];

let redisClientPromise;

function ttlSeconds() {
  return Number(process.env.LIVE_PLAYER_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
}

function redisConfigured() {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

function redisPrefix() {
  return process.env.REDIS_KEY_PREFIX || "oci-defense";
}

function redisSocketOptions() {
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const tls = process.env.REDIS_TLS !== "false";

  return {
    host: process.env.REDIS_HOST,
    port,
    tls,
    reconnectStrategy(retries) {
      return Math.min(50 * retries, 1000);
    }
  };
}

async function redisClient() {
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

function playerKey(sessionId) {
  return `${redisPrefix()}:player:${sessionId}`;
}

function playerEventsKey(sessionId) {
  return `${redisPrefix()}:player-events:${sessionId}`;
}

function playerIndexKey() {
  return `${redisPrefix()}:players`;
}

function emptyEventCounts() {
  return Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]));
}

function normalizeEventCounts(eventCounts) {
  const normalized = emptyEventCounts();
  for (const type of EVENT_TYPES) {
    normalized[type] = Number(eventCounts?.[type] ?? 0);
  }
  return normalized;
}

function incrementEventCounts(eventCounts, type) {
  const nextCounts = normalizeEventCounts(eventCounts);
  if (EVENT_TYPES.includes(type)) {
    nextCounts[type] += 1;
  }
  return nextCounts;
}

function playerSnapshot(event, eventCounts = emptyEventCounts()) {
  return {
    sessionId: event.sessionId,
    runId: event.runId,
    callsign: event.callsign || "UNKNOWN",
    score: Number(event.score ?? 0),
    level: Number(event.level ?? 1),
    wave: Number(event.wave ?? 1),
    bossActive: event.bossActive === true,
    latencyMs: Number(event.metrics?.latencyMs ?? 0),
    fps: Number(event.metrics?.fps ?? 0),
    cloudAction: event.cloudAction ?? "none",
    eventType: event.type,
    eventCounts: normalizeEventCounts(eventCounts),
    vm: event.vm?.name ?? "unknown",
    region: event.vm?.region ?? "unknown",
    lastSeen: event.serverTs ?? new Date().toISOString()
  };
}

function parseSnapshot(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function createMemoryLivePlayers() {
  const players = new Map();
  const recentEvents = new Map();

  function prune(now = Date.now()) {
    const ttlMs = ttlSeconds() * 1000;
    for (const [sessionId, player] of players.entries()) {
      if (new Date(player.lastSeen).getTime() < now - ttlMs) {
        players.delete(sessionId);
        recentEvents.delete(sessionId);
      }
    }

    for (const [sessionId, timestamps] of recentEvents.entries()) {
      recentEvents.set(
        sessionId,
        timestamps.filter((timestamp) => timestamp >= now - EVENT_WINDOW_MS)
      );
    }
  }

  return {
    async update(batch) {
      const now = Date.now();
      for (const event of batch) {
        const existing = players.get(event.sessionId);
        const eventCounts = incrementEventCounts(existing?.eventCounts, event.type);
        players.set(event.sessionId, playerSnapshot(event, eventCounts));
        const timestamps = recentEvents.get(event.sessionId) ?? [];
        timestamps.push(now);
        recentEvents.set(event.sessionId, timestamps);
      }
      prune(now);
    },

    async list() {
      const now = Date.now();
      prune(now);
      return [...players.values()]
        .map((player) => ({
          ...player,
          eventCounts: normalizeEventCounts(player.eventCounts),
          eventsPerSecond: Number(((recentEvents.get(player.sessionId)?.length ?? 0) / 10).toFixed(1))
        }))
        .sort((left, right) => right.score - left.score || Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
    },

    async status() {
      return redisConfigured() ? "fallback-memory" : "memory";
    },

    async reset() {
      players.clear();
      recentEvents.clear();
      return "memory";
    }
  };
}

export function createRedisLivePlayers() {
  const memory = createMemoryLivePlayers();

  async function scanKeys(client, pattern) {
    const keys = [];
    for await (const value of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(value)) {
        keys.push(...value);
      } else {
        keys.push(value);
      }
    }
    return keys;
  }

  async function deleteKeys(client, keys) {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    for (let index = 0; index < uniqueKeys.length; index += 500) {
      await client.del(uniqueKeys.slice(index, index + 500));
    }
  }

  async function updateRedis(batch) {
    const client = await redisClient();
    if (!client) {
      await memory.update(batch);
      return "memory";
    }

    const ttl = ttlSeconds();
    const cutoff = Date.now() - ttl * 1000;
    const eventCutoff = Date.now() - EVENT_WINDOW_MS;
    const sessionIds = [...new Set(batch.map((event) => event.sessionId).filter(Boolean))];
    const previousSnapshots = sessionIds.length > 0
      ? (await client.mGet(sessionIds.map(playerKey))).map(parseSnapshot)
      : [];
    const countsBySession = new Map(
      sessionIds.map((sessionId, index) => [sessionId, normalizeEventCounts(previousSnapshots[index]?.eventCounts)])
    );

    for (const event of batch) {
      countsBySession.set(event.sessionId, incrementEventCounts(countsBySession.get(event.sessionId), event.type));
    }

    const multi = client.multi();

    for (const event of batch) {
      const snapshot = playerSnapshot(event, countsBySession.get(event.sessionId));
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

  return {
    async update(batch) {
      await memory.update(batch);
      if (!redisConfigured()) {
        return "memory";
      }

      try {
        return await updateRedis(batch);
      } catch (error) {
        console.warn("Redis live player update failed, using memory fallback.", error.message);
        return "fallback-memory";
      }
    },

    async list() {
      if (!redisConfigured()) {
        return memory.list();
      }

      try {
        const client = await redisClient();
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
            eventCounts: normalizeEventCounts(player.eventCounts),
            eventsPerSecond: Number((eventCounts[index] / 10).toFixed(1))
          }))
          .sort((left, right) => right.score - left.score || Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
      } catch (error) {
        console.warn("Redis live player read failed, using memory fallback.", error.message);
        return memory.list();
      }
    },

    async status() {
      if (!redisConfigured()) {
        return "memory";
      }

      try {
        const client = await redisClient();
        await client.ping();
        return "connected";
      } catch {
        return "fallback-memory";
      }
    },

    async reset() {
      await memory.reset();
      if (!redisConfigured()) {
        return "memory";
      }

      try {
        const client = await redisClient();
        const sessionIds = await client.zRange(playerIndexKey(), 0, -1).catch(() => []);
        const indexedKeys = sessionIds.flatMap((sessionId) => [
          playerKey(sessionId),
          playerEventsKey(sessionId)
        ]);
        const scannedKeys = [
          ...(await scanKeys(client, `${redisPrefix()}:player:*`)),
          ...(await scanKeys(client, `${redisPrefix()}:player-events:*`))
        ];
        await deleteKeys(client, [playerIndexKey(), ...indexedKeys, ...scannedKeys]);
        return "connected";
      } catch (error) {
        console.warn("Redis live player reset failed; memory fallback was cleared.", error.message);
        return "fallback-memory";
      }
    }
  };
}
