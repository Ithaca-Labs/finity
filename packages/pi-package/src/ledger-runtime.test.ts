import { describe, expect, it } from "vitest";
import { loadDeviceModules } from "./ledger-runtime.js";

describe("loadDeviceModules", () => {
  it("loads all pinned Ledger runtime modules through Node's compatible entrypoints", () => {
    const modules = loadDeviceModules();
    expect(typeof modules.DeviceActionStatus.Completed).toBe("string");
    expect(typeof modules.DeviceManagementKitBuilder).toBe("function");
    expect(typeof modules.nodeHidIdentifier).toBe("string");
    expect(typeof modules.nodeHidTransportFactory).toBe("function");
    expect(typeof modules.SignerEthBuilder).toBe("function");
  });
});
