import { getStreamClient } from "./ociSinks.js";

const DEFAULT_GROUP_NAME = "oci-defense-grid-storage-writers";
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_ERROR_INTERVAL_MS = 5000;
const DEFAULT_LIMIT = 100;

function streamConfigured() {
  return Boolean(process.env.OCI_STREAM_OCID && process.env.OCI_STREAM_MESSAGE_ENDPOINT);
}

function consumerEnabled() {
  return process.env.STREAM_CONSUMER_ENABLED !== "false" && streamConfigured();
}

function decodeMessage(message) {
  try {
    const payload = Buffer.from(String(message.value ?? ""), "base64").toString("utf8");
    const event = JSON.parse(payload);
    return event && typeof event === "object" ? event : null;
  } catch {
    return null;
  }
}

function consumerInstanceName() {
  return process.env.INSTANCE_NAME ?? process.env.HOSTNAME ?? `vm-${process.pid}`;
}

export function createStreamConsumer({
  clientFactory = getStreamClient,
  persistEvents,
  logger = console,
  groupName = process.env.STREAM_CONSUMER_GROUP ?? DEFAULT_GROUP_NAME,
  pollIntervalMs = Number(process.env.STREAM_CONSUMER_POLL_MS ?? DEFAULT_POLL_INTERVAL_MS),
  errorIntervalMs = Number(process.env.STREAM_CONSUMER_ERROR_MS ?? DEFAULT_ERROR_INTERVAL_MS),
  limit = Number(process.env.STREAM_CONSUMER_LIMIT ?? DEFAULT_LIMIT)
} = {}) {
  let timer = null;
  let stopped = false;
  let polling = false;
  let cursor = null;
  const state = {
    enabled: consumerEnabled(),
    status: consumerEnabled() ? "starting" : "disabled",
    groupName,
    processed: 0,
    lastBatchSize: 0,
    lastError: null,
    lastProcessedAt: null
  };

  async function createCursor(client) {
    const response = await client.createGroupCursor({
      streamId: process.env.OCI_STREAM_OCID,
      createGroupCursorDetails: {
        type: "LATEST",
        groupName,
        instanceName: consumerInstanceName(),
        timeoutInMs: 30000,
        commitOnGet: false
      }
    });

    return response.cursor.value;
  }

  function schedule(delayMs = pollIntervalMs) {
    if (stopped || !state.enabled) {
      return;
    }

    timer = setTimeout(poll, delayMs);
    timer.unref?.();
  }

  async function poll() {
    if (polling || stopped || !state.enabled) {
      return;
    }

    polling = true;
    try {
      const client = await clientFactory();
      if (!client || !persistEvents) {
        state.enabled = false;
        state.status = "disabled";
        return;
      }

      cursor ??= await createCursor(client);
      const response = await client.getMessages({
        streamId: process.env.OCI_STREAM_OCID,
        cursor,
        limit
      });
      const nextCursor = response.opcNextCursor ?? cursor;
      const events = (response.items ?? []).map(decodeMessage).filter(Boolean);

      if (events.length > 0) {
        await persistEvents(events);
        await client.consumerCommit?.({
          streamId: process.env.OCI_STREAM_OCID,
          cursor: nextCursor
        });
        state.processed += events.length;
        state.lastBatchSize = events.length;
        state.lastProcessedAt = new Date().toISOString();
      } else {
        state.lastBatchSize = 0;
      }

      cursor = nextCursor;
      state.status = "running";
      state.lastError = null;
      schedule();
    } catch (error) {
      state.status = "error";
      state.lastError = error.message;
      cursor = null;
      logger.warn("Streaming consumer failed.", error.message);
      schedule(errorIntervalMs);
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (!state.enabled || stopped) {
        return;
      }
      schedule(0);
    },
    stop() {
      stopped = true;
      state.status = "stopped";
      if (timer) {
        clearTimeout(timer);
      }
    },
    status() {
      return { ...state };
    }
  };
}
