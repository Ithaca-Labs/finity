import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const onboardingStateSchema = z.object({
  version: z.literal(1),
  stage: z.enum(["BROKER_SEALED", "FUNDED", "BROKER_READY", "MANDATE_READY"]),
  brokerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  principalAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  fundingTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  spendAccountId: z.string().regex(/^0\.0\.[1-9][0-9]*$/).optional(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export async function saveOnboardingState(path: string, state: OnboardingState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(onboardingStateSchema.parse(state), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function loadOnboardingState(path: string): Promise<OnboardingState | undefined> {
  try {
    return onboardingStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
