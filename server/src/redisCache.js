const DEFAULT_CACHE_TTL_SECONDS = 3600;

let redisClientPromise;

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
        console.warn("Redis shared cache error.", error.message);
      });
      await client.connect();
      return client;
    })();
  }

  return redisClientPromise;
}

export function sharedCacheKey(scope, key) {
  return `${redisPrefix()}:${scope}:${key}`;
}

export async function getSharedJson(scope, key) {
  const client = await redisClient();
  if (!client) {
    return null;
  }

  const raw = await client.get(sharedCacheKey(scope, key));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setSharedJson(scope, key, value, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS) {
  const client = await redisClient();
  if (!client) {
    return false;
  }

  await client.set(sharedCacheKey(scope, key), JSON.stringify(value), { EX: ttlSeconds });
  return true;
}
