# Runbook: failures and recovery (8 Oct 2026)

Principle: the money is always in one of four places: the user's wallet, the trading account on Hyperliquid, a recorded
bridge operation, or a known residual. Nothing here requires the app server. Hyperliquid and Unit are the sources of truth;
the local journal is a convenience that can be lost.

## 0. Read the account without the app
```
npx tsx recovery/recover.ts <testnet|mainnet> <0xaddress>
```
Prints perps and spot balances, positions and open orders from the Hyperliquid API only.

## 1. Close everything and keep the money in the account
```
TRADING_PRIVATE_KEY=0x... npx tsx recovery/recover.ts <net> <0xaddress> --exit
```
Cancels open orders, then closes every position with reduce-only orders. Tested on testnet with a live position
(docs/TEST_EVIDENCE.md, Phase 1b). It does not depend on builder-fee approval or on the account mode.

## 2. A send to Unit has an unknown outcome (timeout, crash, closed tab)
Do NOT send again. A spot send has no expiry, so a missing ledger entry is never proof that it did not land.
1. Find the journaled transfer (`transfers:<network>:<account>` in browser storage). It holds the signed `nonce`, destination and amount.
2. Look it up in Hyperliquid's ledger: `userNonFundingLedgerUpdates` for the account; the entry of type `spotTransfer`
   with the same `nonce` and `destination` is the send. `reconcileTransfer` automates this.
3. Found: the send happened. Follow the Unit operation for the destination (`/operations/<hl address>`).
4. Not found: wait at least 10 minutes and look again. After that the app offers an explicit override that records you
   accepted the double-send risk. Check the balance first: if the token balance is unchanged and the ledger is empty, it very likely did not land.
5. Local storage lost: the nonce is gone, so match by destination, amount and time in the same ledger query.

Tested on testnet with a deliberately lost response and wiped storage (docs/TEST_EVIDENCE.md, Phase 4, step B).

## 3. A deposit or withdrawal looks stuck
- Below Unit's minimum (0.07 ZEC for Zcash): Unit documents that such transfers cannot be processed and are reprocessed only
  if the minimum is lowered. Do not top up blindly; ask Unit first. Record the transaction id.
- Unit reports a state we do not recognise, or `failure`: the app shows `manual_recovery` and keeps the raw operation. Keep the
  operation id, the source transaction id and the protocol address, and contact Unit with them.
- Withdrawal confirmation counts conflict in Unit's docs (2,000 versus 5,000 Hyperliquid confirmations). Plan for the longer one.

## 4. The token balance is below the return minimum
The app shows the exact residual and four options, each labelled with its evidence:
| Option | Status on 8 Oct 2026 |
|---|---|
| Keep it in the account | tested: balances stay readable and controllable with the recovery client |
| Sell to USDC | implemented, not exercised live (XZEC book is empty on testnet) |
| Withdraw USDC through Hyperliquid's bridge | attempt failed on testnet: `withdraw3` returned "Error withdrawing from bridge" at 5, 10 and 50 USDC. Do not advertise as working |
| Wait for Unit to lower its minimum | documented only; no promise |

## 5. Wrong or lost return destination
The destination is bound into Unit's protocol address by the guardians. If funds are sent to the protocol address for a
wrong destination, they go to that destination. Verify the destination (the app refuses shielded, unified, TEX and wrong-network
addresses) and the 2-of-3 guardian signatures BEFORE sending, and send only the Unit token, never another token.

## 6. Shielding after a return
Unit pays out a transparent output. The app says "delivered", then "open your wallet and shield". Only evidence from the wallet
itself counts as shielded. A ticked box is "you marked this shielded"; a spent transparent output is "transparent output spent".

## 7. Fees to expect
- Sending a spot token to a brand-new Hyperliquid account costs the SENDER 1.0 USDC on top of the amount (observed on the
  ledger for both the 500 USDC that funded the trading account and a 1 USDC test transfer).
- Unit withdrawal fee for Zcash was 0.00015 ZEC on 8 Oct 2026; it moves, so always read it live.
