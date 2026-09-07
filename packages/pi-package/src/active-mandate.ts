import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ActiveMandate = { mandateId: string; agentUaid: string; brokerUaid?: string };

/**
 * finity_* tools never take a mandateId or agentUaid parameter (user story
 * 20: the agent's authority is bound to its own mandate, not something the
 * model can specify per call). This is the one mandate a Buyer Agent
 * process acts under, set by `/finity mandate new` after a successful
 * on-chain registration.
 */
export async function saveActiveMandate(path: string, mandate: ActiveMandate): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(mandate, null, 2)}\n`, "utf8");
}

export async function loadActiveMandate(path: string): Promise<ActiveMandate | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<ActiveMandate>;
    if (typeof parsed.mandateId !== "string" || typeof parsed.agentUaid !== "string") return undefined;
    return { mandateId: parsed.mandateId, agentUaid: parsed.agentUaid, brokerUaid: parsed.brokerUaid };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
