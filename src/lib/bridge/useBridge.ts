/**
 * useBridge — orchestrates the full Octra → Ethereum bridge in the browser.
 *
 * 1. lock      : sign + submit lock TX on Octra (using user-provided PK)
 * 2. confirm   : poll Octra for confirmation (epoch)
 * 3. find-lock : read bridge contract storage for lock_nonce
 * 4. wait-eth  : poll latestEpoch() on Ethereum until synced
 * 5. proof     : compute leaf hash & verify against bridgeRootOf
 * 6. mint      : user signs verifyAndMint via wallet (RainbowKit) → 0% fee
 */
import { useCallback, useRef, useState } from "react";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import {
  buildLockTx,
  deriveOctraAddress,
  findLockNonce,
  getOctraBalance,
  getOctraTx,
  submitOctraTx,
} from "./octra";
import {
  BRIDGE_CONTRACT,
  DST_BRIDGE_ID,
  DST_CHAIN_ID,
  ETH_RPCS,
  LATEST_EPOCH_CONTRACT,
  OCTRA_FEE_RESERVE,
  SRC_BRIDGE_ID,
  SRC_CHAIN_ID,
  TOKEN_ID,
} from "./constants";
import { BRIDGE_ABI, LATEST_EPOCH_ABI } from "./abi";

export type BridgeStage =
  | "idle"
  | "lock"
  | "confirming"
  | "finding"
  | "waiting_eth"
  | "proof"
  | "minting"
  | "submitting"
  | "done"
  | "error";

const STAGE_LABELS: Record<BridgeStage, string> = {
  idle: "Ready",
  lock: "Signing & locking on Octra…",
  confirming: "Waiting for Octra confirmation…",
  finding: "Locating lock record…",
  waiting_eth: "Waiting for Ethereum sync…",
  proof: "Verifying merkle proof…",
  minting: "Awaiting wallet signature…",
  submitting: "Submitting to Ethereum…",
  done: "Bridge complete!",
  error: "Failed",
};

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

function ethClient() {
  return createPublicClient({
    chain: mainnet,
    transport: http(ETH_RPCS[0]),
  });
}

function safeError(e: unknown): string {
  const s = String((e as Error)?.message ?? e).toLowerCase();
  if (s.includes("user rejected") || s.includes("user denied"))
    return "Transaction rejected by user";
  if (s.includes("insufficient funds") || s.includes("insufficient"))
    return "Insufficient ETH for gas";
  if (s.includes("already")) return "Already processed on Ethereum";
  if (s.includes("proof") || s.includes("mismatch")) return "Proof verification failed";
  if (s.includes("nonce")) return "Nonce conflict, please retry";
  return (e as Error)?.message ?? "Unknown error";
}

export interface BridgeParams {
  octraPk: string;
  amountRaw: bigint;
  ethRecipient: `0x${string}`;
}

export interface BridgeState {
  stage: BridgeStage;
  label: string;
  detail?: string;
  octraTxHash?: string;
  ethTxHash?: string;
  error?: string;
  lockNonce?: number;
  epoch?: number;
}

export function useBridge() {
  const [state, setState] = useState<BridgeState>({ stage: "idle", label: STAGE_LABELS.idle });
  const cancelRef = useRef(false);
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const receipt = useWaitForTransactionReceipt({ hash });

  const update = useCallback((p: Partial<BridgeState>) => {
    setState((s) => ({
      ...s,
      ...p,
      label: p.stage ? STAGE_LABELS[p.stage] : s.label,
    }));
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setHash(undefined);
    setState({ stage: "idle", label: STAGE_LABELS.idle });
  }, []);

  const run = useCallback(
    async ({ octraPk, amountRaw, ethRecipient }: BridgeParams) => {
      cancelRef.current = false;
      try {
        const sender = deriveOctraAddress(octraPk);

        // Step 1: lock
        update({ stage: "lock", detail: "Building lock transaction…" });
        const bal = await getOctraBalance(sender);
        if (bal.balance_raw < amountRaw + OCTRA_FEE_RESERVE)
          throw new Error("Insufficient Octra balance");

        let nonce = Math.max(bal.nonce, bal.pending_nonce);
        let txHash: string | null = null;
        let lastErr: string | undefined;
        for (let i = 0; i < 10; i++) {
          const tx = await buildLockTx(octraPk, sender, nonce, amountRaw, ethRecipient);
          try {
            txHash = await submitOctraTx(tx);
            break;
          } catch (e) {
            lastErr = (e as Error).message;
            if (!lastErr.toLowerCase().includes("nonce")) throw e;
            nonce++;
          }
        }
        if (!txHash) throw new Error(lastErr ?? "Lock submission failed");
        update({ stage: "confirming", octraTxHash: txHash, detail: txHash });

        // Step 2: confirm on Octra
        let epoch: number | undefined;
        for (let i = 0; i < 60; i++) {
          if (cancelRef.current) throw new Error("Cancelled");
          await new Promise((r) => setTimeout(r, 1000));
          const t = await getOctraTx(txHash);
          if (t?.status === "confirmed" && t.epoch) {
            epoch = t.epoch;
            break;
          }
        }
        if (!epoch) throw new Error("Octra TX not confirmed in time");

        // Step 3: locate lock_nonce
        update({ stage: "finding", epoch });
        let lockInfo: { lockNonce: number; amountRaw: bigint } | null = null;
        for (let i = 0; i < 10; i++) {
          lockInfo = await findLockNonce(sender, ethRecipient, amountRaw);
          if (lockInfo) break;
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (!lockInfo) throw new Error("Lock record not found on Octra");
        const lockNonce = lockInfo.lockNonce;
        const finalAmount = lockInfo.amountRaw;
        update({ lockNonce });

        // Step 4: wait for Ethereum sync
        update({ stage: "waiting_eth", detail: `epoch ${epoch}` });
        const client = ethClient();
        let root: `0x${string}` | undefined;
        for (let i = 0; i < 120; i++) {
          if (cancelRef.current) throw new Error("Cancelled");
          const lat = (await client.readContract({
            address: LATEST_EPOCH_CONTRACT,
            abi: LATEST_EPOCH_ABI,
            functionName: "latestEpoch",
          })) as bigint;
          if (lat >= BigInt(epoch)) {
            const r = (await client.readContract({
              address: LATEST_EPOCH_CONTRACT,
              abi: LATEST_EPOCH_ABI,
              functionName: "bridgeRootOf",
              args: [BigInt(epoch)],
            })) as `0x${string}`;
            if (r !== ZERO_HASH) {
              root = r;
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (!root) throw new Error("Ethereum sync timeout");

        // Step 5: build & verify proof
        update({ stage: "proof" });
        const msg = {
          version: 1,
          direction: 0,
          srcChainId: SRC_CHAIN_ID,
          dstChainId: DST_CHAIN_ID,
          srcBridgeId: SRC_BRIDGE_ID,
          dstBridgeId: DST_BRIDGE_ID,
          tokenId: TOKEN_ID,
          recipient: ethRecipient,
          amount: finalAmount,
          srcNonce: BigInt(lockNonce),
        } as const;

        const leaf = (await client.readContract({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "hashBridgeLeaf",
          args: [msg],
        })) as `0x${string}`;
        const computed = (await client.readContract({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "processBridgeProof",
          args: [leaf, [], 0],
        })) as `0x${string}`;
        if (computed !== root) throw new Error("Proof mismatch");

        const mh = (await client.readContract({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "hashBridgeMessage",
          args: [msg],
        })) as `0x${string}`;
        const processed = (await client.readContract({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "processedMessages",
          args: [mh],
        })) as boolean;
        if (processed) throw new Error("Already processed on Ethereum");

        // Step 6: user signs verifyAndMint via wallet (0% fee — direct call, no router)
        update({ stage: "minting" });
        const txEth = await writeContractAsync({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "verifyAndMint",
          args: [BigInt(epoch), msg, [], 0],
        });
        setHash(txEth);
        update({ stage: "submitting", ethTxHash: txEth });

        return txEth;
      } catch (e) {
        update({ stage: "error", error: safeError(e) });
        throw e;
      }
    },
    [update, writeContractAsync],
  );

  if (
    receipt.isSuccess &&
    state.stage === "submitting" &&
    state.ethTxHash === hash
  ) {
    setTimeout(() => update({ stage: "done" }), 0);
  }

  return { state, run, reset, cancel: () => (cancelRef.current = true) };
}

