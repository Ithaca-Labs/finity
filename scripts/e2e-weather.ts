import { homedir } from "node:os";
import { join } from "node:path";
import { FinitydClient, loadActiveMandate, loadFinitydRuntimeInfo } from "@finity/pi-package";

function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index === -1 || index === args.length - 1 ? fallback : (args[index + 1] ?? fallback);
}

function finityHome(): string {
  return process.env.FINITY_HOME ?? join(homedir(), ".finity");
}

function requiredTestnetGuard(): void {
  if (process.env.FINITY_TESTNET !== "1") {
    throw new Error("refusing to spend HBAR: rerun with FINITY_TESTNET=1 after reviewing the active mandate");
  }
}

const terminalStates = new Set([
  "RECONCILED", "REFUSED", "ESCALATION_REQUIRED", "FAILED_DISCOVERY", "FAILED_QUOTE", "FAILED_EVALUATION",
  "FAILED_RESERVATION", "FAILED_PAYMENT", "FAILED_DELIVERY", "FAILED_RECONCILIATION",
]);

async function main(): Promise<void> {
  requiredTestnetGuard();
  const active = await loadActiveMandate(join(finityHome(), "active-mandate.json"));
  if (!active) throw new Error("no active mandate found; complete Ledger setup before running the purchase");
  const client = new FinitydClient(await loadFinitydRuntimeInfo());
  await client.health();

  const city = flag("--city", "London").trim();
  if (!city) throw new Error("--city must not be empty");
  const dataClass = Number(flag("--data-class", "0"));
  if (!Number.isInteger(dataClass) || dataClass < 0 || dataClass > 2) throw new Error("--data-class must be 0, 1, or 2");

  const created = await client.createIntent({
    mandateId: active.mandateId,
    agentUaid: active.agentUaid,
    serviceHint: "hello-weather@1",
    methodId: "weather.current",
    requestClass: { unit: "call", units: "1" },
    payloadRef: `weather.current:${city}`,
    dataClass,
  });

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const purchase = await client.getIntent(created.correlationId);
    const state = typeof purchase.state === "string" ? purchase.state : "UNKNOWN";
    if (terminalStates.has(state)) {
      console.log(JSON.stringify({
        correlationId: created.correlationId,
        state,
        result: purchase.result,
        refusal: purchase.refusal,
      }, null, 2));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`purchase ${created.correlationId} did not reach a terminal state within 90 seconds`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
