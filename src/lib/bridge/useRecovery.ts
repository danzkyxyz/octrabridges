/**
 * useRecovery — scans Octra bridge contract for the user's unprocessed locks
 * and lets them complete verifyAndMint via their connected wallet (RainbowKit).
 */
import { useCallback, useRef, useState } from "react";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { useWriteContract } from "wagmi";
import { deriveOctraAddress, octraRpc } from "./octra";
import {
  BRIDGE_CONTRACT,
  DST_BRIDGE_ID,
  DST_CHAIN_ID,
  ETH_RPCS,
  LATEST_EPOCH_CONTRACT,
  OCTRA_BRIDGE_CONTRACT,
  SRC_BRIDGE_ID,
  SRC_CHAIN_ID,
  TOKEN_ID,
} from "./constants";
import { BRIDGE_ABI, LATEST_EPOCH_ABI } from "./abi";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface LockRecord {
  nonce: number;
  amount: bigint;
  amountHuman: string;
  ethRecipient: string;
  processed: boolean;
  status: "pending" | "scanning" | "recovering" | "done" | "error";
  error?: string;
  ethTxHash?: string;
}

export type RecoveryStage = "idle" | "scanning" | "ready" | "recovering" | "done" | "error";

export interface RecoveryState {
  stage: RecoveryStage;
  locks: LockRecord[];
  error?: string;
}

function ethClient() {
  return createPublicClient({ chain: mainnet, transport: http(ETH_RPCS[0]) });
}

export function useRecovery() {
  const [state, setState] = useState<RecoveryState>({ stage: "idle", locks: [] });
  const cancelRef = useRef(false);
  const { writeContractAsync } = useWriteContract();

  const scan = useCallback(async (octraPk: string) => {
    cancelRef.current = false;
    setState({ stage: "scanning", locks: [] });

    try {
      const octraAddr = deriveOctraAddress(octraPk);

      // Read bridge contract storage
      const st = await octraRpc<{ storage: Record<string, string> }>(
        "contract_call",
        [OCTRA_BRIDGE_CONTRACT, "version", []],
      );
      const storage = st.storage;
      const lockNonce = Number(storage.lock_nonce);

      // Find user's locks
      const userLocks: LockRecord[] = [];
      for (let n = 1; n <= lockNonce; n++) {
        if (cancelRef.current) throw new Error("Cancelled");
        const sender = storage[`lock_history:${n}`];
        if (sender === octraAddr) {
          const amount = BigInt(storage[`lock_amounts:${n}`] || "0");
          const ethRecipient = storage[`lock_eth_recipients:${n}`] || "";
          userLocks.push({
            nonce: n,
            amount,
            amountHuman: (Number(amount) / 1e6).toFixed(6),
            ethRecipient,
            processed: false,
            status: "scanning",
          });
        }
      }

      if (userLocks.length === 0) {
        setState({ stage: "ready", locks: [] });
        return;
      }

      // Check which locks are already processed on Ethereum
      const client = ethClient();
      for (const lock of userLocks) {
        if (cancelRef.current) throw new Error("Cancelled");
        try {
          const msg = buildBridgeMsg(lock);
          const msgHash = (await client.readContract({
            address: BRIDGE_CONTRACT,
            abi: BRIDGE_ABI,
            functionName: "hashBridgeMessage",
            args: [msg],
          })) as `0x${string}`;
          const processed = (await client.readContract({
            address: BRIDGE_CONTRACT,
            abi: BRIDGE_ABI,
            functionName: "processedMessages",
            args: [msgHash],
          })) as boolean;
          lock.processed = processed;
          lock.status = processed ? "done" : "pending";
        } catch {
          lock.status = "pending";
        }
      }

      setState({ stage: "ready", locks: userLocks });
    } catch (e) {
      setState({
        stage: "error",
        locks: [],
        error: (e as Error).message,
      });
    }
  }, []);

  const recover = useCallback(
    async (lock: LockRecord, octraPk: string) => {
      cancelRef.current = false;
      setState((s) => ({
        ...s,
        stage: "recovering",
        locks: s.locks.map((l) =>
          l.nonce === lock.nonce ? { ...l, status: "recovering" as const, error: undefined } : l,
        ),
      }));

      try {
        const client = ethClient();
        const msg = buildBridgeMsg(lock);

        // Compute leaf & proof root
        const leaf = (await client.readContract({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "hashBridgeLeaf",
          args: [msg],
        })) as `0x${string}`;
        const computedRoot = (await client.readContract({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "processBridgeProof",
          args: [leaf, [], 0],
        })) as `0x${string}`;

        // Get latest epoch and user_last_lock_epoch hint
        const latestEpoch = (await client.readContract({
          address: LATEST_EPOCH_CONTRACT,
          abi: LATEST_EPOCH_ABI,
          functionName: "latestEpoch",
        })) as bigint;

        const octraAddr = deriveOctraAddress(octraPk);
        const stHint = await octraRpc<{ storage: Record<string, string> }>(
          "contract_call",
          [OCTRA_BRIDGE_CONTRACT, "version", []],
        );
        const hintKey = `user_last_lock_epoch:${octraAddr}`;
        const hintEpoch = stHint.storage[hintKey]
          ? Number(stHint.storage[hintKey])
          : Number(latestEpoch);
        const ethLatest = Number(latestEpoch);

        // Search epochs
        let matchedEpoch: number | null = null;
        const ranges: [number, number][] = [
          [hintEpoch, Math.max(1, hintEpoch - 300)],
          [Math.min(ethLatest, hintEpoch + 300), hintEpoch + 1],
          [ethLatest, Math.max(1, ethLatest - 300)],
          [Math.max(1, hintEpoch - 300), Math.max(1, hintEpoch - 3000)],
        ];

        search:
        for (const [start, end] of ranges) {
          if (cancelRef.current) throw new Error("Cancelled");
          const step = start >= end ? -1 : 1;
          for (let ep = start; step < 0 ? ep >= end : ep <= end; ep += step) {
            if (cancelRef.current) throw new Error("Cancelled");
            try {
              const root = (await client.readContract({
                address: LATEST_EPOCH_CONTRACT,
                abi: LATEST_EPOCH_ABI,
                functionName: "bridgeRootOf",
                args: [BigInt(ep)],
              })) as `0x${string}`;
              if (root === computedRoot && root !== ZERO_HASH) {
                matchedEpoch = ep;
                break search;
              }
            } catch {
              /* skip */
            }
          }
        }

        if (!matchedEpoch) {
          throw new Error(
            "No matching epoch found. This lock may require siblings (multi-message epoch) or the epoch hasn't synced yet.",
          );
        }

        // Call verifyAndMint
        const txHash = await writeContractAsync({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "verifyAndMint",
          args: [BigInt(matchedEpoch), msg, [], 0],
        });

        setState((s) => ({
          ...s,
          stage: "ready",
          locks: s.locks.map((l) =>
            l.nonce === lock.nonce
              ? { ...l, status: "done" as const, processed: true, ethTxHash: txHash }
              : l,
          ),
        }));
      } catch (e) {
        const errMsg = (e as Error).message;
        const friendly = errMsg.includes("rejected")
          ? "Transaction rejected by user"
          : errMsg.includes("insufficient")
            ? "Insufficient ETH for gas"
            : errMsg;
        setState((s) => ({
          ...s,
          stage: "ready",
          locks: s.locks.map((l) =>
            l.nonce === lock.nonce ? { ...l, status: "error" as const, error: friendly } : l,
          ),
        }));
      }
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    cancelRef.current = true;
    setState({ stage: "idle", locks: [] });
  }, []);

  return { state, scan, recover, reset };
}

function buildBridgeMsg(lock: LockRecord) {
  return {
    version: 1,
    direction: 0,
    srcChainId: SRC_CHAIN_ID,
    dstChainId: DST_CHAIN_ID,
    srcBridgeId: SRC_BRIDGE_ID,
    dstBridgeId: DST_BRIDGE_ID,
    tokenId: TOKEN_ID,
    recipient: lock.ethRecipient as `0x${string}`,
    amount: lock.amount,
    srcNonce: BigInt(lock.nonce),
  } as const;
}
