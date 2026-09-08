import {
  createPublicClient,
  hexToBytes,
  http,
  serializeTransaction,
  type Address,
  type Hex,
} from "viem";
import type { Signature as LedgerSignature } from "@ledgerhq/device-signer-kit-ethereum";
import { hederaTestnetChain } from "@finity/registry-client";
import { getEthereumAddressOnDevice, signTransactionOnDevice } from "./ledger.js";

const EVM_WEI_PER_TINYBAR = 10_000_000_000n;

export type FundingClient = {
  getBalance(args: { address: Address }): Promise<bigint>;
  getTransactionCount(args: { address: Address }): Promise<number>;
  getGasPrice(): Promise<bigint>;
  estimateGas(args: { account: Address; to: Address; value: bigint }): Promise<bigint>;
  sendRawTransaction(args: { serializedTransaction: Hex }): Promise<Hex>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
};

export type LedgerFundingDeps = {
  publicClient?: FundingClient;
  getAddress?: typeof getEthereumAddressOnDevice;
  signTransaction?: typeof signTransactionOnDevice;
};

export function ledgerSignatureParity(v: number, chainId = 296): 0 | 1 {
  if (v === 0 || v === 1) return v;
  if (v === 27 || v === 28) return (v - 27) as 0 | 1;
  const parity = v - (chainId * 2 + 35);
  if (parity === 0 || parity === 1) return parity;
  throw new Error(`Ledger returned unsupported transaction signature v=${v}`);
}

export async function fundBrokerFromLedger(input: {
  brokerAddress: Address;
  amountTinybar: string;
  rpcUrl?: string;
  derivationPath: string;
  confirm(summary: { principalAddress: Address; brokerAddress: Address; amountTinybar: string; maxFeeTinybar: string }): Promise<boolean>;
}, deps: LedgerFundingDeps = {}): Promise<{ principalAddress: Address; transactionHash: Hex }> {
  const client = deps.publicClient ?? createPublicClient({ chain: hederaTestnetChain, transport: http(input.rpcUrl) });
  const getAddress = deps.getAddress ?? getEthereumAddressOnDevice;
  const signTransaction = deps.signTransaction ?? signTransactionOnDevice;
  const principalAddress = await getAddress({ derivationPath: input.derivationPath });
  const value = BigInt(input.amountTinybar) * EVM_WEI_PER_TINYBAR;
  if (value <= 0n) throw new Error("funding amount must be positive");
  const [balance, nonce, gasPrice, gas] = await Promise.all([
    client.getBalance({ address: principalAddress }),
    client.getTransactionCount({ address: principalAddress }),
    client.getGasPrice(),
    client.estimateGas({ account: principalAddress, to: input.brokerAddress, value }),
  ]);
  const maxFee = gasPrice * gas;
  if (balance < value + maxFee) throw new Error("Ledger account balance is too low for the requested funding amount plus network fee");
  if (!(await input.confirm({ principalAddress, brokerAddress: input.brokerAddress, amountTinybar: input.amountTinybar, maxFeeTinybar: (maxFee / EVM_WEI_PER_TINYBAR).toString() }))) {
    throw new Error("funding cancelled by user");
  }
  const transaction = { chainId: 296, type: "legacy" as const, nonce, gas, gasPrice, to: input.brokerAddress, value };
  const unsigned = serializeTransaction(transaction);
  const signature: LedgerSignature = await signTransaction({ derivationPath: input.derivationPath, transaction: hexToBytes(unsigned) });
  const serializedTransaction = serializeTransaction(transaction, {
    r: signature.r as Hex,
    s: signature.s as Hex,
    v: BigInt(ledgerSignatureParity(signature.v) + 27),
  });
  const transactionHash = await client.sendRawTransaction({ serializedTransaction });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error(`funding transaction ${transactionHash} reverted`);
  return { principalAddress, transactionHash };
}

export async function resolveHederaAccountId(
  evmAddress: Address,
  options: { mirrorNodeUrl?: string; fetchImpl?: typeof fetch; attempts?: number; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.mirrorNodeUrl ?? "https://testnet.mirrornode.hedera.com/api/v1";
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < (options.attempts ?? 20); attempt += 1) {
    const response = await fetchImpl(`${baseUrl}/accounts/${evmAddress}`);
    if (response.ok) {
      const body = await response.json() as { account?: unknown };
      if (typeof body.account === "string" && /^0\.0\.[1-9][0-9]*$/.test(body.account)) return body.account;
    }
    if (attempt + 1 < (options.attempts ?? 20)) await wait(500);
  }
  throw new Error(`funded broker alias ${evmAddress} did not resolve to a Hedera account ID`);
}
