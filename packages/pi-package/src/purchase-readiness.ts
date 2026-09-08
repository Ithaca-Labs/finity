import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { signedAgentMandateSchema, type SignedAgentMandate } from "@finity/schemas";
import { loadActiveMandate, type ActiveMandate } from "./active-mandate.js";
import { loadIdentityFile, type Identity } from "./identity.js";

export type PurchaseRequest = {
  serviceId: string;
  methodId: string;
  unit: string;
  units: string;
  amount?: string;
  dataClass: number;
};

export type BrokerState = {
  identity: Identity;
  bundlePath: string;
  brokerAddress?: `0x${string}`;
  spendAccountId?: string;
};

export type ReadyPurchaseState = {
  active: ActiveMandate;
  mandate: SignedAgentMandate;
  broker: BrokerState;
  reusedBroker: boolean;
  reusedMandate: boolean;
};

export type PurchaseReadinessDeps = {
  home: string;
  now(): number;
  readMandateStatus(mandateId: `0x${string}`): Promise<number>;
  provisionBroker(): Promise<BrokerState>;
  createMandate(broker: BrokerState, request: PurchaseRequest): Promise<{ active: ActiveMandate; mandate: SignedAgentMandate }>;
  ensureDaemon(): Promise<void>;
};

function includes(csv: string, value: string): boolean {
  return csv.split(",").map((item) => item.trim()).filter(Boolean).includes(value);
}

export function mandateAllows(mandate: SignedAgentMandate, request: PurchaseRequest, now: number): boolean {
  if (mandate.validFrom > now || mandate.validUntil <= now) return false;
  if (!includes(mandate.allowedServices, request.serviceId)) return false;
  if (!includes(mandate.allowedMethods, request.methodId)) return false;
  if (mandate.asset !== "HBAR") return false;
  if (request.dataClass > mandate.dataClass) return false;
  const maxUnits = BigInt(mandate.maxUnitsPerRequest);
  if (maxUnits !== 0n && BigInt(request.units) > maxUnits) return false;
  if (request.amount !== undefined && BigInt(request.amount) > BigInt(mandate.maxPerRequest)) return false;
  return true;
}

async function existingBroker(home: string): Promise<BrokerState | undefined> {
  const bundlePath = join(home, "bundles", "broker.enc");
  const identity = await loadIdentityFile(join(home, "identity.json"));
  if (!identity?.broker) return undefined;
  try {
    await access(bundlePath);
  } catch {
    return undefined;
  }
  let brokerAddress: `0x${string}` | undefined;
  let spendAccountId = /^hedera:testnet:(0\.0\.[1-9][0-9]*)$/.exec(identity.broker.canonical.nativeId)?.[1];
  const active = await loadActiveMandate(join(home, "active-mandate.json"));
  if (active) {
    try {
      const mandate = signedAgentMandateSchema.parse(JSON.parse(await readFile(join(home, "mandates", `${active.mandateId}.json`), "utf8")));
      brokerAddress = mandate.broker as `0x${string}`;
      spendAccountId ??= mandate.spendAccount;
    } catch {
      // Public metadata is optional here; createMandate can recover it from
      // the sealed bundle when migrating an older setup.
    }
  }
  return { identity: identity.broker, bundlePath, brokerAddress, spendAccountId };
}

async function existingMandate(
  deps: PurchaseReadinessDeps,
  broker: BrokerState,
  request: PurchaseRequest,
): Promise<{ active: ActiveMandate; mandate: SignedAgentMandate } | undefined> {
  const active = await loadActiveMandate(join(deps.home, "active-mandate.json"));
  if (!active || active.brokerUaid !== broker.identity.uaid || !/^0x[0-9a-fA-F]{64}$/.test(active.mandateId)) return undefined;
  let mandate: SignedAgentMandate;
  try {
    mandate = signedAgentMandateSchema.parse(JSON.parse(await readFile(join(deps.home, "mandates", `${active.mandateId}.json`), "utf8")));
  } catch {
    return undefined;
  }
  if (mandate.mandateId !== active.mandateId || !mandateAllows(mandate, request, deps.now())) return undefined;
  try {
    if ((await deps.readMandateStatus(active.mandateId as `0x${string}`)) !== 1) return undefined;
  } catch {
    return undefined;
  }
  return { active, mandate };
}

/**
 * Single entry point for natural-language purchases. It reuses every valid
 * layer and provisions only the first missing layer, then makes sure finityd
 * is available before returning. No key or password crosses this interface.
 */
export async function ensureReadyForPurchase(request: PurchaseRequest, deps: PurchaseReadinessDeps): Promise<ReadyPurchaseState> {
  const foundBroker = await existingBroker(deps.home);
  const broker = foundBroker ?? await deps.provisionBroker();
  const foundMandate = await existingMandate(deps, broker, request);
  await deps.ensureDaemon();
  const mandate = foundMandate ?? await deps.createMandate(broker, request);
  return {
    ...mandate,
    broker,
    reusedBroker: foundBroker !== undefined,
    reusedMandate: foundMandate !== undefined,
  };
}
