import fdk from "@fnproject/fdk";
import { createIngestHandler } from "./lib/handler.js";
import { createIngestSinks } from "./lib/sinks.js";

const sinks = createIngestSinks();

fdk.handle(
  createIngestHandler({
    recordEvents: sinks
  })
);
