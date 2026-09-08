import type { DeviceActionStatus as DeviceActionStatusType, DeviceManagementKitBuilder as DeviceManagementKitBuilderType } from "@ledgerhq/device-management-kit";
import type { nodeHidIdentifier as nodeHidIdentifierType, nodeHidTransportFactory as nodeHidTransportFactoryType } from "@ledgerhq/device-transport-kit-node-hid";
import type { Address as LedgerAddress, SignerEthBuilder as SignerEthBuilderType, Signature, TypedData } from "@ledgerhq/device-signer-kit-ethereum";

export class LedgerSigningError extends Error {
  constructor(
    readonly code: "NO_DEVICE" | "CONNECT_FAILED" | "ADDRESS_FAILED" | "SIGN_FAILED",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LedgerSigningError";
  }
}

/**
 * `r`/`s`/`v` from the Ethereum app come back as separate fields (HW_TODO.md:
 * the exact v convention - 27/28 vs 0/1 - has not been confirmed against a
 * real device response). Normalized the same way MandateRegistry.sol's
 * `_recover` does, so a real signature either verifies on first try or fails
 * loudly with a clear place to fix the convention.
 */
export function assembleSignature(signature: Signature): `0x${string}` {
  const r = signature.r.startsWith("0x") ? signature.r.slice(2) : signature.r;
  const s = signature.s.startsWith("0x") ? signature.s.slice(2) : signature.s;
  const v = signature.v < 27 ? signature.v + 27 : signature.v;
  if (r.length !== 64 || s.length !== 64) {
    throw new LedgerSigningError("SIGN_FAILED", "device returned an r or s component that is not 32 bytes");
  }
  return `0x${r}${s}${v.toString(16).padStart(2, "0")}`;
}

export type SignTypedDataOnDeviceOptions = {
  derivationPath: string;
  typedData: TypedData;
  discoveryTimeoutMs?: number;
};

export type LedgerDeviceOptions = {
  derivationPath: string;
  discoveryTimeoutMs?: number;
};

type DeviceModules = Awaited<ReturnType<typeof loadDeviceModules>>;
type EthSigner = ReturnType<SignerEthBuilderType["build"]>;

async function loadDeviceModules() {
  const [dmkModule, transportModule, signerModule] = await Promise.all([
    import("@ledgerhq/device-management-kit") as Promise<{ DeviceActionStatus: typeof DeviceActionStatusType; DeviceManagementKitBuilder: typeof DeviceManagementKitBuilderType }>,
    import("@ledgerhq/device-transport-kit-node-hid") as Promise<{ nodeHidIdentifier: typeof nodeHidIdentifierType; nodeHidTransportFactory: typeof nodeHidTransportFactoryType }>,
    import("@ledgerhq/device-signer-kit-ethereum") as Promise<{ SignerEthBuilder: typeof SignerEthBuilderType }>,
  ]);
  return { ...dmkModule, ...transportModule, ...signerModule };
}

async function withLedgerSigner<T>(
  options: LedgerDeviceOptions,
  operation: (signer: EthSigner, status: DeviceModules["DeviceActionStatus"]) => Promise<T>,
): Promise<T> {
  const [{ DeviceActionStatus, DeviceManagementKitBuilder, nodeHidIdentifier, nodeHidTransportFactory, SignerEthBuilder }, { firstValueFrom }] = await Promise.all([
    loadDeviceModules(),
    import("rxjs"),
  ]);
  const dmk = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
  try {
    const discovered = await Promise.race([
      firstValueFrom(dmk.startDiscovering({ transport: nodeHidIdentifier })),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new LedgerSigningError("NO_DEVICE", "no Ledger device found over USB HID")), options.discoveryTimeoutMs ?? 15_000),
      ),
    ]);
    let sessionId: string;
    try {
      sessionId = await dmk.connect({ device: discovered });
    } catch (error) {
      throw new LedgerSigningError("CONNECT_FAILED", "failed to connect to the discovered Ledger device", { cause: error });
    }
    try {
      return await operation(new SignerEthBuilder({ dmk, sessionId }).build(), DeviceActionStatus);
    } finally {
      await dmk.disconnect({ sessionId }).catch(() => undefined);
    }
  } finally {
    dmk.close();
  }
}

function deviceActionOutput<T>(
  observable: { subscribe(observer: { next(state: { status: string; output?: T; error?: unknown }): void; error(error: unknown): void }): { unsubscribe(): void } },
  completed: string,
  failed: string,
  code: "ADDRESS_FAILED" | "SIGN_FAILED",
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const subscription = observable.subscribe({
      next(state) {
        if (state.status === completed) {
          resolve(state.output as T);
          subscription.unsubscribe();
        } else if (state.status === failed) {
          reject(new LedgerSigningError(code, message, { cause: state.error }));
          subscription.unsubscribe();
        }
      },
      error(error) {
        reject(new LedgerSigningError(code, `${message}: device action errored`, { cause: error }));
      },
    });
  });
}

/** Reads and displays the fixed Finity Ethereum account on the Ledger. */
export async function getEthereumAddressOnDevice(options: LedgerDeviceOptions): Promise<`0x${string}`> {
  return withLedgerSigner(options, async (signer, status) => {
    const action = signer.getAddress(options.derivationPath, { checkOnDevice: true, chainId: 296 });
    const output = await deviceActionOutput<LedgerAddress>(action.observable, status.Completed, status.Error, "ADDRESS_FAILED", "device rejected or failed address verification");
    if (!/^0x[0-9a-fA-F]{40}$/.test(output.address)) {
      throw new LedgerSigningError("ADDRESS_FAILED", "device returned a malformed Ethereum address");
    }
    return output.address as `0x${string}`;
  });
}

/** Signs one already-serialized EVM transaction after Ledger review. */
export async function signTransactionOnDevice(options: LedgerDeviceOptions & { transaction: Uint8Array }): Promise<Signature> {
  return withLedgerSigner(options, async (signer, status) => {
    const action = signer.signTransaction(options.derivationPath, options.transaction);
    return deviceActionOutput<Signature>(action.observable, status.Completed, status.Error, "SIGN_FAILED", "device rejected or failed the transaction signing request");
  });
}

/**
 * Connects to the first Ledger found over USB HID, opens the Ethereum app's
 * EIP-712 signing flow, and returns the assembled 65-byte signature.
 *
 * The Ledger DMK packages are imported dynamically rather than statically:
 * pi's extension loader (jiti) fails every extension that has a *static*
 * top-level import of @ledgerhq/device-signer-kit-ethereum anywhere in its
 * module graph with "Cannot redefine property: module.exports" - confirmed
 * by bisecting imports directly against the installed pi 0.85.1 CLI.
 * Dynamic import() avoids it entirely and only pays the load cost when a
 * mandate is actually being signed.
 *
 * HW-UNVERIFIED (docs/HW_TODO.md): never run against a physical device in
 * this environment. The discover -> connect -> sign -> disconnect sequence
 * follows the verified DMK API surface (VERIFIED.md), but the device
 * actually prompting, the Ethereum app actually being open, and the v
 * normalization above have not been exercised for real.
 */
export async function signTypedDataOnDevice(options: SignTypedDataOnDeviceOptions): Promise<`0x${string}`> {
  return withLedgerSigner(options, async (signer, status) => {
      const { observable } = signer.signTypedData(options.derivationPath, options.typedData);
      const signature = await deviceActionOutput<Signature>(observable, status.Completed, status.Error, "SIGN_FAILED", "device rejected or failed the signing request");
      return assembleSignature(signature);
  });
}
