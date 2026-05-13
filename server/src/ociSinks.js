import { randomUUID } from "node:crypto";

let providerPromise;
let streamClientPromise;
let objectClientPromise;

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

export async function publishEventsToStreaming(batch) {
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
