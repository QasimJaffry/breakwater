import { createCollector } from "./server";
import { Store } from "./store";
const port = Number(process.env.PORT ?? 4319);
createCollector({
  store: new Store(process.env.BREAKWATER_DB ?? "breakwater.db"),
  ingestKey: process.env.BREAKWATER_INGEST_KEY,
  readKey: process.env.BREAKWATER_READ_KEY,
  allowOrigin: process.env.BREAKWATER_ALLOW_ORIGIN,
}).listen(port, () => console.log(`breakwater collector listening on :${port}`));
