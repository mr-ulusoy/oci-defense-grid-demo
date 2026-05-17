import assert from "node:assert/strict";
import { test } from "node:test";
import { createStreamConsumer } from "../src/streamConsumer.js";

function withStreamEnv(callback) {
  const previous = {
    OCI_STREAM_OCID: process.env.OCI_STREAM_OCID,
    OCI_STREAM_MESSAGE_ENDPOINT: process.env.OCI_STREAM_MESSAGE_ENDPOINT,
    STREAM_CONSUMER_ENABLED: process.env.STREAM_CONSUMER_ENABLED
  };

  process.env.OCI_STREAM_OCID = "ocid1.stream.oc1..test";
  process.env.OCI_STREAM_MESSAGE_ENDPOINT = "https://cell.streaming.example.com";
  delete process.env.STREAM_CONSUMER_ENABLED;

  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function waitFor(predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for stream consumer.")), 500);
    const tick = () => {
      if (predicate()) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

test("stream consumer is disabled without stream configuration", () => {
  delete process.env.OCI_STREAM_OCID;
  delete process.env.OCI_STREAM_MESSAGE_ENDPOINT;

  const consumer = createStreamConsumer();
  assert.equal(consumer.status().enabled, false);
  assert.equal(consumer.status().status, "disabled");
});

test("stream consumer reads stream messages and commits after persistence", async () =>
  withStreamEnv(async () => {
    const event = {
      id: "event-1",
      runId: "run-1",
      sessionId: "session-1",
      type: "enemy_killed",
      level: 1,
      score: 100,
      metrics: { fps: 60, latencyMs: 20 },
      vm: { name: "oci-function" }
    };
    const messages = [
      {
        value: Buffer.from(JSON.stringify(event)).toString("base64")
      }
    ];
    let committedCursor = null;
    let persisted = [];

    const fakeClient = {
      async createGroupCursor(request) {
        assert.equal(request.streamId, process.env.OCI_STREAM_OCID);
        assert.equal(request.createGroupCursorDetails.type, "LATEST");
        assert.equal(request.createGroupCursorDetails.commitOnGet, false);
        return { cursor: { value: "cursor-1" } };
      },
      async getMessages(request) {
        assert.equal(request.cursor, "cursor-1");
        return { opcNextCursor: "cursor-2", items: messages };
      },
      async consumerCommit(request) {
        committedCursor = request.cursor;
      }
    };

    const consumer = createStreamConsumer({
      clientFactory: async () => fakeClient,
      persistEvents: async (events) => {
        persisted = events;
      },
      pollIntervalMs: 25,
      errorIntervalMs: 25,
      logger: { warn() {} }
    });

    consumer.start();
    await waitFor(() => committedCursor === "cursor-2");
    consumer.stop();

    assert.deepEqual(persisted, [event]);
    assert.equal(consumer.status().processed, 1);
  }));
