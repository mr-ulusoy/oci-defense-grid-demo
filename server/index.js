import dotenv from "dotenv";
import { createApp } from "./src/app.js";
import { createStore } from "./src/store.js";
import { createStreamConsumer } from "./src/streamConsumer.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const store = createStore();
const streamConsumer = createStreamConsumer({
  persistEvents: store.persistConsumedEvents
});
const app = createApp({ store, streamConsumer });

app.listen(port, "0.0.0.0", () => {
  console.log(`OCI Defense Grid API listening on ${port}`);
  streamConsumer.start();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    streamConsumer.stop();
    process.exit(0);
  });
}
