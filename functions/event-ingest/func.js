import fdk from "@fnproject/fdk";

fdk.handle(async (input) => {
  const events = Array.isArray(input?.events) ? input.events : [input].filter(Boolean);

  return {
    accepted: events.length,
    target: "oci-streaming",
    note: "V1 function stub. Use this container image when moving POST /api/events from VM API to OCI Functions."
  };
});
