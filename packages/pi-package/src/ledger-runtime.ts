import { createRequire } from "node:module";
import type { DeviceActionStatus as DeviceActionStatusType, DeviceManagementKitBuilder as DeviceManagementKitBuilderType } from "@ledgerhq/device-management-kit";
import type { nodeHidIdentifier as nodeHidIdentifierType, nodeHidTransportFactory as nodeHidTransportFactoryType } from "@ledgerhq/device-transport-kit-node-hid";
import type { SignerEthBuilder as SignerEthBuilderType } from "@ledgerhq/device-signer-kit-ethereum";

const requireLedgerModule = createRequire(import.meta.url);

export type LedgerDeviceModules = {
  DeviceActionStatus: typeof DeviceActionStatusType;
  DeviceManagementKitBuilder: typeof DeviceManagementKitBuilderType;
  nodeHidIdentifier: typeof nodeHidIdentifierType;
  nodeHidTransportFactory: typeof nodeHidTransportFactoryType;
  SignerEthBuilder: typeof SignerEthBuilderType;
};

/**
 * Loads Ledger's Node runtime modules only when a hardware operation starts.
 * DMK 1.9.0's ESM build contains native-Node-incompatible directory imports;
 * its published CommonJS build resolves the same API correctly.
 */
export function loadDeviceModules(): LedgerDeviceModules {
  const dmkModule = requireLedgerModule("@ledgerhq/device-management-kit") as Pick<LedgerDeviceModules, "DeviceActionStatus" | "DeviceManagementKitBuilder">;
  const transportModule = requireLedgerModule("@ledgerhq/device-transport-kit-node-hid") as Pick<LedgerDeviceModules, "nodeHidIdentifier" | "nodeHidTransportFactory">;
  const signerModule = requireLedgerModule("@ledgerhq/device-signer-kit-ethereum") as Pick<LedgerDeviceModules, "SignerEthBuilder">;
  return { ...dmkModule, ...transportModule, ...signerModule };
}
