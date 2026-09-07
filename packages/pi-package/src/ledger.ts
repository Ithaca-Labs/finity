import type { DeviceActionStatus as DeviceActionStatusType, DeviceManagementKitBuilder as DeviceManagementKitBuilderType } from "@ledgerhq/device-management-kit";
import type { nodeHidIdentifier as nodeHidIdentifierType, nodeHidTransportFactory as nodeHidTransportFactoryType } from "@ledgerhq/device-transport-kit-node-hid";
import type { SignerEthBuilder as SignerEthBuilderType, Signature, TypedData } from "@ledgerhq/device-signer-kit-ethereum";

export class LedgerSigningError extends Error {
  constructor(
    readonly code: "NO_DEVICE" | "CONNECT_FAILED" | "SIGN_FAILED",
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
  const [{ DeviceActionStatus, DeviceManagementKitBuilder }, { nodeHidIdentifier, nodeHidTransportFactory }, { SignerEthBuilder }, { firstValueFrom }] = await Promise.all([
    import("@ledgerhq/device-management-kit") as Promise<{ DeviceActionStatus: typeof DeviceActionStatusType; DeviceManagementKitBuilder: typeof DeviceManagementKitBuilderType }>,
    import("@ledgerhq/device-transport-kit-node-hid") as Promise<{ nodeHidIdentifier: typeof nodeHidIdentifierType; nodeHidTransportFactory: typeof nodeHidTransportFactoryType }>,
    import("@ledgerhq/device-signer-kit-ethereum") as Promise<{ SignerEthBuilder: typeof SignerEthBuilderType }>,
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
      const signer = new SignerEthBuilder({ dmk, sessionId }).build();
      const { observable } = signer.signTypedData(options.derivationPath, options.typedData);
      const signature = await new Promise<Signature>((resolve, reject) => {
        const subscription = observable.subscribe({
          next(state) {
            if (state.status === DeviceActionStatus.Completed) {
              resolve(state.output);
              subscription.unsubscribe();
            } else if (state.status === DeviceActionStatus.Error) {
              reject(new LedgerSigningError("SIGN_FAILED", "device rejected or failed the signing request", { cause: state.error }));
              subscription.unsubscribe();
            }
          },
          error(error) {
            reject(new LedgerSigningError("SIGN_FAILED", "signing observable errored", { cause: error }));
          },
        });
      });
      return assembleSignature(signature);
    } finally {
      await dmk.disconnect({ sessionId }).catch(() => undefined);
    }
  } finally {
    dmk.close();
  }
}
