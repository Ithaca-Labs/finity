import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { compile, compileRevocation, type MandateChoices } from "@finity/mandate-compiler";
import { POLICY_HASH } from "@finity/policy-engine";
import type { SignedAgentMandate } from "@finity/schemas";
import { clearActiveMandate, loadActiveMandate, saveActiveMandate, type ActiveMandate } from "../active-mandate.js";
import { explainRefusal, pollPurchase } from "../buyer-tools.js";
import { approveEscalation, type ProposedAmendment } from "../escalation-wizard.js";
import { FinitydClient, FinitydError, loadFinitydRuntimeInfo } from "../finityd-client.js";
import { generateIdentity, loadIdentityFile, saveIdentityFile } from "../identity.js";
import { runSetupWizard, type WizardUI } from "../setup-wizard.js";
import { signTypedDataOnDevice } from "../ledger.js";
import { ensureInteractivePurchaseReady } from "../interactive-onboarding.js";
import { genuineCheck, ringInit } from "../wallet-cli-ops.js";
import { walletPassFromEnvironmentOrKeychain } from "../wallet-pass.js";
import { createRegistryClient } from "@finity/registry-client";

const REQUEST_UNITS = ["call", "char", "token", "row", "byte", "second"] as const;
const BLOCKED_BUILTIN_TOOLS = new Set(["bash", "write", "edit"]);

function finityHome(): string {
  return process.env.FINITY_HOME ?? join(homedir(), ".finity");
}

async function walletPassFromEnv(): Promise<string> {
  return walletPassFromEnvironmentOrKeychain();
}

function wizardUiFrom(ctx: ExtensionContext): WizardUI {
  return {
    notify: (message, kind) => ctx.ui.notify(message, kind === "error" ? "error" : "info"),
    confirm: (title, message) => ctx.ui.confirm(title, message),
    input: (title, message) => ctx.ui.input(title, message),
  };
}

async function finitydClient(): Promise<FinitydClient> {
  const runtime = await loadFinitydRuntimeInfo();
  return new FinitydClient(runtime);
}

async function requireActiveMandate(): Promise<ActiveMandate> {
  const mandate = await loadActiveMandate(join(finityHome(), "active-mandate.json"));
  if (!mandate) throw new Error("No active mandate. Run /finity mandate new (or /finity mandate show if one is already registered) first.");
  return mandate;
}

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data as Record<string, unknown> };
}

export default function finityExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (BLOCKED_BUILTIN_TOOLS.has(event.toolName)) {
      return { block: true, reason: "Finity Agent has no shell: use the finity_* tools instead of bash/write/edit." };
    }
  });

  pi.registerTool({
    name: "finity_buy",
    label: "Buy via Finity",
    description: "Completes a purchase, reusing a valid broker and mandate or interactively provisioning only missing authority.",
    promptSnippet: "Buy a Finity service and onboard the Principal only when required",
    promptGuidelines: [
      "Use finity_buy directly for a user purchase request; it performs discovery, quoting, readiness checks, and purchase.",
      "For current Kolkata weather use serviceId hello-weather@1, methodId weather.current, unit call, units 1, payloadRef weather.current:Kolkata, dataClass 0.",
      "Never ask for a private key, password, seed phrase, or account ID.",
    ],
    parameters: Type.Object({
      serviceId: Type.String({ description: "Exact Finity service ID, e.g. hello-weather@1" }),
      methodId: Type.String({ description: "Exact method ID, e.g. weather.current" }),
      unit: StringEnum(REQUEST_UNITS),
      units: Type.String({ description: "Unsigned integer string, e.g. \"1\"" }),
      payloadRef: Type.String({ description: "Opaque request reference, e.g. weather.current:Kolkata" }),
      dataClass: Type.Integer({ minimum: 0, maximum: 2 }),
      preferCheapest: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const daemonPath = process.env.FINITY_DAEMON_PATH;
      if (!daemonPath) throw new Error("FINITY_DAEMON_PATH is unavailable; launch the agent through the finity CLI");
      const ready = await ensureInteractivePurchaseReady({
        ui: wizardUiFrom(ctx), home: finityHome(), daemonPath,
        request: {
          serviceId: params.serviceId, methodId: params.methodId,
          requestClass: { unit: params.unit, units: params.units },
          payloadRef: params.payloadRef, dataClass: params.dataClass, preferCheapest: params.preferCheapest,
        },
      });
      const created = await ready.client.createIntent({
        mandateId: ready.activeMandateId, agentUaid: ready.agentUaid,
        serviceHint: params.serviceId, methodId: params.methodId,
        requestClass: { unit: params.unit, units: params.units }, payloadRef: params.payloadRef,
        dataClass: params.dataClass,
        constraints: params.preferCheapest === undefined ? undefined : { preferCheapest: params.preferCheapest },
      });
      const purchase = await pollPurchase((id) => ready.client.getIntent(id), created.correlationId);
      return toolResult({ purchase, onboarding: { reusedBroker: ready.reusedBroker, reusedMandate: ready.reusedMandate } });
    },
  });

  pi.registerTool({
    name: "finity_discover",
    label: "Discover Finity Services",
    description: "Lists the services this agent's active mandate allows it to buy from.",
    promptSnippet: "Discover services eligible under the active mandate",
    parameters: Type.Object({}),
    async execute() {
      const mandate = await requireActiveMandate();
      return toolResult(await (await finitydClient()).listServices(mandate.mandateId));
    },
  });

  pi.registerTool({
    name: "finity_quote",
    label: "Quote Finity Service",
    description: "Requests a signed price quote for one service and method under the active mandate.",
    promptSnippet: "Get a price quote for a specific service and method",
    parameters: Type.Object({
      serviceId: Type.String({ description: "Service ID from finity_discover, e.g. hello-weather@1" }),
      methodId: Type.String({ description: "Method ID from finity_discover's manifest" }),
      unit: StringEnum(REQUEST_UNITS),
      units: Type.String({ description: "Unsigned integer string, e.g. \"1\"" }),
    }),
    async execute(_toolCallId, params) {
      const mandate = await requireActiveMandate();
      return toolResult(
        await (await finitydClient()).requestQuotes({
          mandateId: mandate.mandateId, serviceId: params.serviceId, methodId: params.methodId,
          requestClass: { unit: params.unit, units: params.units },
        }),
      );
    },
  });

  pi.registerTool({
    name: "finity_purchase",
    label: "Purchase via Finity",
    description: "Buys one request from a service under the active mandate and returns the receipt, or the refusal if policy declined it.",
    promptSnippet: "Purchase one request from a service under the active mandate",
    promptGuidelines: [
      "Call finity_discover then finity_quote before finity_purchase so the service/method/unit choice is informed, not guessed.",
      "Never ask the user for keys, passwords, or account numbers to use finity_purchase - the active mandate already authorizes it.",
    ],
    parameters: Type.Object({
      serviceHint: Type.Optional(Type.String({ description: "Service ID to prefer, e.g. hello-weather@1" })),
      methodId: Type.Optional(Type.String()),
      unit: StringEnum(REQUEST_UNITS),
      units: Type.String({ description: "Unsigned integer string, e.g. \"1\"" }),
      payloadRef: Type.String({ description: "Opaque reference to the request payload - never the raw secret or full prompt" }),
      dataClass: Type.Integer({ minimum: 0, maximum: 2, description: "0=public, 1=internal, 2=sensitive" }),
      preferCheapest: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params) {
      const mandate = await requireActiveMandate();
      const client = await finitydClient();
      const created = await client.createIntent({
        mandateId: mandate.mandateId,
        agentUaid: mandate.agentUaid,
        serviceHint: params.serviceHint,
        methodId: params.methodId,
        requestClass: { unit: params.unit, units: params.units },
        payloadRef: params.payloadRef,
        dataClass: params.dataClass,
        constraints: params.preferCheapest === undefined ? undefined : { preferCheapest: params.preferCheapest },
      });
      return toolResult(await pollPurchase((id) => client.getIntent(id), created.correlationId));
    },
  });

  pi.registerTool({
    name: "finity_explain_refusal",
    label: "Explain Finity Refusal",
    description: "Explains in plain language why a past purchase was refused or requires escalation.",
    promptSnippet: "Explain why a purchase was refused or needs escalation",
    parameters: Type.Object({ correlationId: Type.String({ description: "correlationId returned by finity_purchase" }) }),
    async execute(_toolCallId, params) {
      const purchase = await (await finitydClient()).getIntent(params.correlationId);
      const explanation = explainRefusal(purchase.refusal as { decision?: string; reasonCodes?: unknown; proposedAmendment?: unknown } | undefined);
      return { content: [{ type: "text" as const, text: explanation }], details: { purchase, explanation } };
    },
  });

  pi.registerTool({
    name: "finity_request_escalation",
    label: "Request Finity Escalation",
    description: "Asks the Principal to approve a one-time increase for a purchase that requires escalation.",
    promptSnippet: "Ask the Principal to approve a one-time mandate exception",
    parameters: Type.Object({ correlationId: Type.String({ description: "correlationId of a purchase in ESCALATION_REQUIRED state" }) }),
    async execute(_toolCallId, params) {
      const client = await finitydClient();
      const purchase = await client.getIntent(params.correlationId);
      const receiptId = (purchase.refusal as { receiptId?: string } | undefined)?.receiptId;
      if (!receiptId) throw new Error(`Purchase ${params.correlationId} has no escalatable receipt (not in ESCALATION_REQUIRED state).`);
      return toolResult(await client.requestEscalation(receiptId));
    },
  });

  pi.registerTool({
    name: "finity_status",
    label: "Finity Status",
    description: "Reports whether finityd is reachable and lists pending escalations.",
    promptSnippet: "Check whether the Finity broker is running",
    parameters: Type.Object({}),
    async execute() {
      const client = await finitydClient();
      const [health, escalations] = await Promise.all([
        client.health(),
        client.listEscalations().catch(() => ({ escalations: [] as unknown[] })),
      ]);
      return toolResult({ health, ...escalations });
    },
  });

  pi.registerCommand("finity", {
    description: "Finity setup, mandate, and diagnostics commands (setup | mandate new|list|show | escalations [approve|reject <id>] | revoke <id> | trace <mandateId> | doctor | kill on|off)",
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      try {
        switch (subcommand) {
          case "setup":
            await handleSetup(ctx);
            return;
          case "mandate":
            await handleMandate(rest, ctx);
            return;
          case "doctor":
            await handleDoctor(ctx);
            return;
          case "escalations":
            await handleEscalations(rest, ctx);
            return;
          case "trace":
            handleTrace(rest, ctx);
            return;
          case "revoke":
            await handleRevoke(rest, ctx);
            return;
          case "kill":
            await handleKillSwitch(rest, ctx);
            return;
          default:
            ctx.ui.notify("Usage: /finity setup | mandate new|list|show | escalations [approve|reject <id>] | revoke <id> | trace <mandateId> | doctor | kill on|off", "info");
        }
      } catch (error) {
        ctx.ui.notify(`/finity ${subcommand ?? ""} failed: ${(error as Error).message}`, "error");
      }
    },
  });
}

async function handleSetup(ctx: ExtensionCommandContext): Promise<void> {
  const home = finityHome();
  const result = await runSetupWizard({
    ui: wizardUiFrom(ctx),
    genuineCheck,
    ringInit,
    walletPass: walletPassFromEnv,
    bundlesDir: join(home, "bundles"),
    identityPath: join(home, "identity.json"),
    brokerId: "default",
    hostname: hostname(),
  });
  if (!result.ok) ctx.ui.notify(`Setup did not complete: ${result.reason}`, "error");
}

async function handleMandate(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const [action] = args;
  const home = finityHome();
  if (action === "show") {
    const active = await loadActiveMandate(join(home, "active-mandate.json"));
    ctx.ui.notify(active ? JSON.stringify(active) : "No active mandate.", "info");
    return;
  }
  if (action === "list") {
    ctx.ui.notify("Only one active mandate per Buyer Agent process is tracked locally; use /finity mandate show.", "info");
    return;
  }
  if (action !== "new") {
    ctx.ui.notify("Usage: /finity mandate new|list|show", "info");
    return;
  }

  const draftPath = join(home, "mandate-draft.json");
  let choices: Record<string, unknown>;
  try {
    choices = JSON.parse(await readFile(draftPath, "utf8"));
  } catch {
    ctx.ui.notify(`No mandate draft found at ${draftPath}. Create one with the fields from fixtures/mandate-weather.json (agent, allowedServices, allowedMethods, asset, maxPerRequest, maxPerPeriod, periodSeconds, maxLifetime, maxUnitsPerRequest, quoteMaxAgeSeconds, dataClass, escalationRule, nonce, predecessor) and re-run.`, "error");
    return;
  }

  const registryAddress = process.env.FINITY_REGISTRY_ADDRESS;
  const identity = await loadIdentityFile(join(home, "identity.json"));
  if (!registryAddress || !identity?.broker) {
    ctx.ui.notify("FINITY_REGISTRY_ADDRESS must be set and /finity setup must have completed (for the broker identity) before registering a mandate.", "error");
    return;
  }

  const agentIdentity = await generateIdentity({ name: "finity-buyer", nativeId: identity.broker.canonical.nativeId, uid: "buyer" });
  await saveIdentityFile(join(home, "identity.json"), { ...identity, agent: agentIdentity });

  const confirmed = await ctx.ui.confirm(
    "Register mandate",
    "This will ask your Ledger to sign the mandate now. Review the fields on the device screen before approving.",
  );
  if (!confirmed) return;

  const compiled = compile({
    ...choices, agent: agentIdentity.uaid, policyHash: POLICY_HASH, verifyingContract: registryAddress,
  } as MandateChoices);
  const signature = await signTypedDataOnDevice({
    derivationPath: "44'/60'/0'/0/0",
    typedData: { ...compiled.typedData, types: { AgentMandate: [...compiled.typedData.types.AgentMandate] } },
  });
  const signedMandate: SignedAgentMandate = { ...compiled.canonicalMandate, signature, mandateId: compiled.mandateId };
  ctx.ui.notify("Ledger signature received. Registering the mandate through finityd...", "info");
  const registered = await (await finitydClient()).registerMandateOnChain(signedMandate);
    // finityd's MandateStore needs the full signed mandate content, not just
    // an ID: MandateRegistry.record() only exposes consumption/status
    // on-chain, never the original allowedServices/allowedMethods/asset
    // text (see @finity/finityd's MandateStore doc comment).
    await mkdir(join(home, "mandates"), { recursive: true });
  await writeFile(join(home, "mandates", `${compiled.mandateId}.json`), `${JSON.stringify(signedMandate, null, 2)}\n`, "utf8");
  await saveActiveMandate(join(home, "active-mandate.json"), { mandateId: compiled.mandateId, agentUaid: agentIdentity.uaid, brokerUaid: identity.broker.uaid });
  ctx.ui.notify(`Mandate registered: ${compiled.mandateId}. Trace topic: ${String(registered.traceTopicId ?? "pending")}.`, "info");
}

async function handleDoctor(ctx: ExtensionCommandContext): Promise<void> {
  try {
    const client = await finitydClient();
    const health = await client.health();
    ctx.ui.notify(`finityd: ${JSON.stringify(health)}`, "info");
  } catch (error) {
    ctx.ui.notify(`finityd unreachable: ${error instanceof FinitydError ? error.message : (error as Error).message}`, "error");
  }
  const active = await loadActiveMandate(join(finityHome(), "active-mandate.json"));
  ctx.ui.notify(active ? `Active mandate: ${active.mandateId}` : "No active mandate set.", "info");
}

/** `/finity escalations [approve|reject <escalationId>]`: only the Principal can approve or reject - never a tool the LLM calls. */
async function handleEscalations(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const [action, escalationId] = args;
  const client = await finitydClient();

  if (!action) {
    ctx.ui.notify(JSON.stringify(await client.listEscalations()), "info");
    return;
  }
  if (action !== "approve" && action !== "reject") {
    ctx.ui.notify("Usage: /finity escalations [approve|reject <escalationId>]", "info");
    return;
  }
  if (!escalationId) {
    ctx.ui.notify(`Usage: /finity escalations ${action} <escalationId>`, "info");
    return;
  }
  if (action === "reject") {
    await client.resolveEscalation(escalationId, "REJECTED");
    ctx.ui.notify(`Escalation ${escalationId} rejected.`, "info");
    return;
  }
  await handleApproveEscalation(escalationId, client, ctx);
}

async function handleApproveEscalation(escalationId: string, client: FinitydClient, ctx: ExtensionCommandContext): Promise<void> {
  const { escalations } = (await client.listEscalations()) as { escalations: Array<{ escalationId: string; mandateId: string; proposedAmendment: ProposedAmendment }> };
  const escalation = escalations.find((candidate) => candidate.escalationId === escalationId);
  if (!escalation) {
    ctx.ui.notify(`No pending escalation ${escalationId}.`, "error");
    return;
  }
  const registryAddress = process.env.FINITY_REGISTRY_ADDRESS;
  if (!registryAddress) {
    ctx.ui.notify("FINITY_REGISTRY_ADDRESS must be set.", "error");
    return;
  }
  const home = finityHome();
  const predecessorRaw = await readFile(join(home, "mandates", `${escalation.mandateId}.json`), "utf8").catch(() => undefined);
  if (!predecessorRaw) {
    ctx.ui.notify(`No local record of mandate ${escalation.mandateId}; cannot approve.`, "error");
    return;
  }
  const predecessorMandate = JSON.parse(predecessorRaw) as SignedAgentMandate;

  const confirmed = await ctx.ui.confirm(
    "Approve escalation",
    `Approve a one-time increase to ${escalation.proposedAmendment.newValueText} for ${escalation.proposedAmendment.scopeServiceId}? Review the fields on your Ledger before approving.`,
  );
  if (!confirmed) return;

  const registryClient = createRegistryClient({ contractAddress: registryAddress, rpcUrl: process.env.FINITY_RPC_URL });
  const result = await approveEscalation({
    mandateId: escalation.mandateId as `0x${string}`,
    predecessorMandate,
    proposedAmendment: escalation.proposedAmendment,
    registryClient,
    verifyingContract: registryAddress as `0x${string}`,
    sign: (typedData) =>
      signTypedDataOnDevice({
        derivationPath: "44'/60'/0'/0/0",
        typedData: { ...typedData, types: { MandateAmendment: [...typedData.types.MandateAmendment] } },
      }),
  });

  await mkdir(join(home, "mandates"), { recursive: true });
  await writeFile(join(home, "mandates", `${result.successorMandateId}.json`), `${JSON.stringify(result.successorMandate, null, 2)}\n`, "utf8");
  await client.registerMandate(result.successorMandate);

  const activePath = join(home, "active-mandate.json");
  const active = await loadActiveMandate(activePath);
  if (active?.mandateId === escalation.mandateId) {
    await saveActiveMandate(activePath, { ...active, mandateId: result.successorMandateId });
  }

  await client.resolveEscalation(escalationId, "APPROVED");
  ctx.ui.notify(`Escalation approved. New mandate ${result.successorMandateId} is now active.`, "info");
}

function handleTrace(args: string[], ctx: ExtensionCommandContext): void {
  const [mandateId] = args;
  if (!mandateId) {
    ctx.ui.notify("Usage: /finity trace <mandateId>", "info");
    return;
  }
  ctx.ui.notify(
    `Read MandateRegistry.record(${mandateId}).traceTopic from the registry (FINITY_REGISTRY_ADDRESS) and open https://hashscan.io/testnet/topic/<that topic ID>. Automatic lookup is not wired yet.`,
    "info",
  );
}

/** `/finity revoke <mandateId>`: an emergency stop, signed on the Ledger (FINITY_BUILD_SPEC.md step 17/19). */
async function handleRevoke(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const active = await loadActiveMandate(join(finityHome(), "active-mandate.json"));
  const mandateId = (args[0] ?? active?.mandateId) as `0x${string}` | undefined;
  if (!mandateId) {
    ctx.ui.notify("Usage: /finity revoke <mandateId> (or set an active mandate first with /finity mandate new)", "info");
    return;
  }
  const registryAddress = process.env.FINITY_REGISTRY_ADDRESS;
  if (!registryAddress) {
    ctx.ui.notify("FINITY_REGISTRY_ADDRESS must be set.", "error");
    return;
  }
  const reason = await ctx.ui.input("Revoke mandate", `Reason for revoking mandate ${mandateId} (shown on your Ledger screen):`);
  if (!reason) {
    ctx.ui.notify("Revocation cancelled: no reason provided.", "info");
    return;
  }
  const confirmed = await ctx.ui.confirm("Revoke mandate", `This immediately and permanently revokes mandate ${mandateId}. Review the fields on your Ledger before approving.`);
  if (!confirmed) return;

  // The contract scopes nonces per principal, not per mandate, and this
  // codebase has no nonce registry to pick the next sequential one from -
  // a millisecond timestamp is a pragmatic, effectively-unique choice for a
  // rare, human-triggered action like this.
  const { typedData, canonicalRevocation } = compileRevocation({
    mandateId, nonce: String(Date.now()), reason, verifyingContract: registryAddress as `0x${string}`,
  });
  const signature = await signTypedDataOnDevice({
    derivationPath: "44'/60'/0'/0/0",
    typedData: { ...typedData, types: { Revocation: [...typedData.types.Revocation] } },
  });
  const result = await (await finitydClient()).revokeMandateOnChain({ revocation: canonicalRevocation, signature });
  if (result.status !== "REVOKED") throw new Error("finityd did not confirm the mandate is REVOKED on-chain");
  await clearActiveMandate(join(finityHome(), "active-mandate.json"), mandateId);
  const trace = result.traceStatus === "SUBMITTED" ? " Revocation trace submitted to HCS." : "";
  ctx.ui.notify(`Mandate ${mandateId} revoked on Hedera testnet.${trace}`, "info");
}

/** `/finity kill on|off`: a broker-level emergency stop that needs no device, no network, and no signature - a file finityd checks before accepting any new intent. */
async function handleKillSwitch(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const path = join(finityHome(), "kill-switch");
  const [action] = args;
  if (action === "on") {
    await mkdir(finityHome(), { recursive: true });
    await writeFile(path, `activated ${new Date().toISOString()}\n`, "utf8");
    ctx.ui.notify("Kill switch activated: finityd will refuse all new purchases until this is cleared.", "info");
    return;
  }
  if (action === "off") {
    await rm(path, { force: true });
    ctx.ui.notify("Kill switch cleared.", "info");
    return;
  }
  ctx.ui.notify("Usage: /finity kill on|off", "info");
}
