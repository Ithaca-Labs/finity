// Persists the nonsecret funding record (mapping + observed operations) so a reload or a
// provider outage never loses a deposit. Storage can be unavailable; callers must cope with null.
import type { FundingRecord } from "../bridge/funding";
import type { ReturnRecord } from "../bridge/returns";

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const key = (r: Pick<FundingRecord, "network" | "hlAddress" | "source">) => `funding:v1:${r.network}:${r.source}:${r.hlAddress.toLowerCase()}`;

export function loadFunding(kv: KV | undefined, id: Pick<FundingRecord, "network" | "hlAddress" | "source">): FundingRecord | null {
  try {
    const s = kv?.getItem(key(id));
    return s ? (JSON.parse(s) as FundingRecord) : null;
  } catch {
    return null;
  }
}

export function saveFunding(kv: KV | undefined, rec: FundingRecord): boolean {
  try {
    kv?.setItem(key(rec), JSON.stringify(rec));
    return !!kv;
  } catch {
    return false;
  }
}

// Return record: the verified route, the journaled send and Unit operations. Same rules as funding.

const rkey = (r: Pick<ReturnRecord, "network" | "hlAddress" | "source">) => `return:v1:${r.network}:${r.source}:${r.hlAddress.toLowerCase()}`;

export function loadReturn(kv: KV | undefined, id: Pick<ReturnRecord, "network" | "hlAddress" | "source">): ReturnRecord | null {
  try {
    const s = kv?.getItem(rkey(id));
    return s ? (JSON.parse(s) as ReturnRecord) : null;
  } catch {
    return null;
  }
}

export function saveReturn(kv: KV | undefined, rec: ReturnRecord): boolean {
  try {
    kv?.setItem(rkey(rec), JSON.stringify(rec));
    return !!kv;
  } catch {
    return false;
  }
}
