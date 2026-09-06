import assert from "node:assert/strict";
import type { Signer, TypedDataDomain, TypedDataField } from "ethers";
import { network } from "hardhat";
import type { MandateRegistry } from "../types/ethers-contracts/MandateRegistry.js";

const { ethers, networkHelpers } = await network.create();

const DOMAIN: TypedDataDomain = {
  name: "FinityMandate",
  version: "1",
  chainId: 296,
};

const MANDATE_TYPES: Record<string, Array<TypedDataField>> = {
  AgentMandate: [
    { name: "agent", type: "string" },
    { name: "broker", type: "address" },
    { name: "spendAccount", type: "string" },
    { name: "allowedServices", type: "string" },
    { name: "allowedMethods", type: "string" },
    { name: "asset", type: "string" },
    { name: "maxPerRequest", type: "uint256" },
    { name: "maxPerRequestText", type: "string" },
    { name: "maxPerPeriod", type: "uint256" },
    { name: "maxPerPeriodText", type: "string" },
    { name: "periodSeconds", type: "uint256" },
    { name: "maxLifetime", type: "uint256" },
    { name: "maxLifetimeText", type: "string" },
    { name: "maxUnitsPerRequest", type: "uint256" },
    { name: "validFrom", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "validUntilText", type: "string" },
    { name: "quoteMaxAgeSeconds", type: "uint256" },
    { name: "dataClass", type: "uint8" },
    { name: "escalationRule", type: "string" },
    { name: "policyHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "predecessor", type: "bytes32" },
  ],
};

const REVOCATION_TYPES: Record<string, Array<TypedDataField>> = {
  Revocation: [
    { name: "mandateId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "reason", type: "string" },
  ],
};

const AMENDMENT_TYPES: Record<string, Array<TypedDataField>> = {
  MandateAmendment: [
    { name: "mandateId", type: "bytes32" },
    { name: "field", type: "uint256" },
    { name: "newValue", type: "uint256" },
    { name: "newValueText", type: "string" },
    { name: "scopeServiceId", type: "string" },
    { name: "oneTime", type: "bool" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

type MandateInput = MandateRegistry.AgentMandateStruct;
type TestSigner = Signer & { address: string };

async function deployRegistry(): Promise<MandateRegistry> {
  const registry = await ethers.deployContract("MandateRegistry");
  await registry.waitForDeployment();
  return registry as unknown as MandateRegistry;
}

async function mandateFor(
  broker: string,
  nonce: bigint,
  validFrom: bigint,
  validUntil: bigint,
): Promise<MandateInput> {
  return {
    agent: "did:aid:finity:buyer",
    broker,
    spendAccount: "0.0.1234",
    allowedServices: "hello-weather,summarize-lite",
    allowedMethods: "weather.current,summarize.text",
    asset: "HBAR",
    maxPerRequest: 50_000_000n,
    maxPerRequestText: "0.50 HBAR",
    maxPerPeriod: 500_000_000n,
    maxPerPeriodText: "5.00 HBAR / 24 hours",
    periodSeconds: 86_400n,
    maxLifetime: 2_000_000_000n,
    maxLifetimeText: "20.00 HBAR total",
    maxUnitsPerRequest: 10_000n,
    validFrom,
    validUntil,
    validUntilText: "until 2030-01-01T00:00:00.000Z",
    quoteMaxAgeSeconds: 60n,
    dataClass: 1,
    escalationRule: "ask principal for a one-time increase",
    policyHash: ethers.id("finity-policy-v1"),
    nonce,
    predecessor: ethers.ZeroHash,
  };
}

async function signMandate(
  principal: TestSigner,
  registryAddress: string,
  mandate: MandateInput,
): Promise<{ id: string; signature: string }> {
  const domain = { ...DOMAIN, verifyingContract: registryAddress };
  const signature = await principal.signTypedData(domain, MANDATE_TYPES, mandate);
  const id = ethers.TypedDataEncoder.hash(domain, MANDATE_TYPES, mandate);
  return { id, signature };
}

async function register(
  registry: MandateRegistry,
  principal: TestSigner,
  broker: string,
  nonce: bigint,
): Promise<{ id: string; mandate: MandateInput }> {
  const block = await ethers.provider.getBlock("latest");
  assert.ok(block);
  const mandate = await mandateFor(broker, nonce, BigInt(block.timestamp - 1), BigInt(block.timestamp + 3_600));
  const signed = await signMandate(principal, await registry.getAddress(), mandate);
  await (await registry.registerMandate(mandate, signed.signature)).wait();
  return { id: signed.id, mandate };
}

describe("MandateRegistry", function () {
  it("matches the Finity EIP-712 digest and records the principal", async function () {
    const registry = await deployRegistry();
    const [principal, broker] = (await ethers.getSigners()) as [TestSigner, TestSigner];
    assert.equal((await ethers.provider.getNetwork()).chainId, 296n);

    const registered = await register(registry, principal, broker.address, 1n);
    const structHash = ethers.TypedDataEncoder.hashStruct("AgentMandate", MANDATE_TYPES, registered.mandate);
    assert.equal(await registry.hashAgentMandate(registered.mandate), structHash);
    assert.equal(await registry.hashTypedData(structHash), registered.id);

    const record = await registry.record(registered.id);
    assert.equal(record.principal, principal.address);
    assert.equal(record.broker, broker.address);
    assert.equal(record.status, 1n);
    assert.equal(record.limits.maxPerRequest, 50_000_000n);
  });

  it("enforces broker-only reservations and budget caps", async function () {
    const registry = await deployRegistry();
    const [principal, broker, outsider] = (await ethers.getSigners()) as [TestSigner, TestSigner, TestSigner];
    const registered = await register(registry, principal, broker.address, 2n);

    await assert.rejects(registry.connect(outsider).reserve(registered.id, 1n));
    const reservationId = await registry.connect(broker).reserve.staticCall(registered.id, 40_000_000n);
    await (await registry.connect(broker).reserve(registered.id, 40_000_000n)).wait();
    const reserved = await registry.record(registered.id);
    assert.equal(reserved.reserved, 40_000_000n);
    await assert.rejects(registry.connect(broker).reserve(registered.id, 60_000_000n));

    await (await registry.connect(broker).finalize(reservationId, 35_000_000n)).wait();
    const finalized = await registry.record(registered.id);
    assert.equal(finalized.reserved, 0n);
    assert.equal(finalized.periodConsumed, 35_000_000n);
    assert.equal(finalized.lifetimeConsumed, 35_000_000n);
  });

  it("reports expiry and rejects reservations outside the mandate window", async function () {
    const registry = await deployRegistry();
    const [principal, broker] = (await ethers.getSigners()) as [TestSigner, TestSigner];
    const registered = await register(registry, principal, broker.address, 6n);

    await networkHelpers.time.increase(3_601);
    assert.equal(await registry.status(registered.id), 3n);
    await assert.rejects(registry.connect(broker).reserve(registered.id, 1n));
  });

  it("allows broker or timeout release, but never double-finalizes", async function () {
    const registry = await deployRegistry();
    const [principal, broker, outsider] = (await ethers.getSigners()) as [TestSigner, TestSigner, TestSigner];
    const registered = await register(registry, principal, broker.address, 3n);
    const reservationId = await registry.connect(broker).reserve.staticCall(registered.id, 10_000_000n);
    await (await registry.connect(broker).reserve(registered.id, 10_000_000n)).wait();
    await assert.rejects(registry.connect(outsider).release(reservationId));
    await (await registry.connect(broker).release(reservationId)).wait();
    await assert.rejects(registry.connect(broker).release(reservationId));

    const timeoutReservation = await registry.connect(broker).reserve.staticCall(registered.id, 10_000_000n);
    await (await registry.connect(broker).reserve(registered.id, 10_000_000n)).wait();
    await networkHelpers.time.increase(601);
    await (await registry.connect(outsider).release(timeoutReservation)).wait();
    assert.equal((await registry.record(registered.id)).reserved, 0n);
  });

  it("handles expiry, revocation, trace topic, and one-time amendments", async function () {
    const registry = await deployRegistry();
    const [principal, broker, relayer] = (await ethers.getSigners()) as [TestSigner, TestSigner, TestSigner];
    const registered = await register(registry, principal, broker.address, 4n);

    await (await registry.connect(broker).setTraceTopic(registered.id, "0.0.9001")).wait();
    assert.equal((await registry.record(registered.id)).traceTopic, "0.0.9001");
    await assert.rejects(registry.connect(broker).setTraceTopic(registered.id, "0.0.9002"));

    const block = await ethers.provider.getBlock("latest");
    assert.ok(block);
    const revocation = { mandateId: registered.id, nonce: 40n, reason: "principal emergency stop" };
    const revocationSignature = await principal.signTypedData(
      { ...DOMAIN, verifyingContract: await registry.getAddress() },
      REVOCATION_TYPES,
      revocation,
    );
    await (await registry.connect(relayer).revoke(revocation, revocationSignature)).wait();
    assert.equal(await registry.status(registered.id), 4n);
    await assert.rejects(registry.connect(broker).reserve(registered.id, 1n));

    const amended = await register(registry, principal, broker.address, 5n);
    const amendment = {
      mandateId: amended.id,
      field: 0n,
      newValue: 100_000_000n,
      newValueText: "1.00 HBAR",
      scopeServiceId: "hello-weather",
      oneTime: true,
      validUntil: BigInt(amended.mandate.validUntil) - 100n,
      nonce: 50n,
    };
    const amendmentSignature = await principal.signTypedData(
      { ...DOMAIN, verifyingContract: await registry.getAddress() },
      AMENDMENT_TYPES,
      amendment,
    );
    const successorId = await registry.connect(relayer).amend.staticCall(amendment, amendmentSignature);
    await (await registry.connect(relayer).amend(amendment, amendmentSignature)).wait();
    assert.equal(await registry.status(amended.id), 5n);
    assert.equal(await registry.status(successorId), 1n);
    assert.equal((await registry.record(successorId)).limits.maxPerRequest, 100_000_000n);

    const exceptionReservation = await registry.connect(broker).reserve.staticCall(successorId, 90_000_000n);
    await (await registry.connect(broker).reserve(successorId, 90_000_000n)).wait();
    await (await registry.connect(broker).finalize(exceptionReservation, 90_000_000n)).wait();
    assert.equal(await registry.status(successorId), 2n);
    await assert.rejects(registry.connect(broker).reserve(successorId, 1n));
  });
});
