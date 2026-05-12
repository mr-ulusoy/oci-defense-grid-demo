import dotenv from "dotenv";
import { createApp } from "./src/app.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, "0.0.0.0", () => {
  console.log(`OCI Defense Grid API listening on ${port}`);
});
