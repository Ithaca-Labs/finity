import { createHelloWeatherService, helloWeatherManifest } from "@finity/hello-weather";
import { loadProviderRuntime } from "./provider-runtime.js";

const runtime = await loadProviderRuntime("A", helloWeatherManifest);
const app = createHelloWeatherService({
  manifest: runtime.manifest,
  signer: runtime.signer,
  facilitatorUrl: process.env.FINITY_FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
});
const server = app.listen(runtime.port, () => {
  console.log(`hello-weather listening on port ${runtime.port}; public origin ${runtime.baseUrl}`);
});
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
