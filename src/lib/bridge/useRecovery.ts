/**
 * useRecovery — fetches lock_to_eth TXs from Octra (with exact epochs),
 * checks which are unprocessed on Ethereum, and lets the user complete
 * verifyAndMint via their connected wallet (RainbowKit).
 *
 * Uses octra_transactionsByAddress for exact epoch lookup (no blind search).
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
  epoch: number;
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

interface OctraTx {
  hash: string;
  epoch: number;
  from: string;
  to?: string;
  to_?: string;
  amount: string;
  encrypted_data?: string;
  message?: string;
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

      // 1. Fetch TX history from Octra (with exact epochs)
      const txHistory = await octraRpc<{
        transactions: OctraTx[];
        rejected?: OctraTx[];
      }>("octra_transactionsByAddress", [octraAddr]);

      const lockTxs = (txHistory.transactions || [])
        .filter(
          (tx) =>
            tx.encrypted_data === "lock_to_eth" &&
            (tx.to_ || tx.to) === OCTRA_BRIDGE_CONTRACT,
        )
        .sort((a, b) => a.epoch - b.epoch); // oldest first = nonce order

      if (lockTxs.length === 0) {
        setState({ stage: "ready", locks: [] });
        return;
      }

      // 2. Read bridge storage to map nonces
      const st = await octraRpc<{ storage: Record<string, string> }>(
        "contract_call",
        [OCTRA_BRIDGE_CONTRACT, "version", []],
      );
      const storage = st.storage;
      const lockNonce = Number(storage.lock_nonce);

      const userNonces: number[] = [];
      for (let n = 1; n <= lockNonce; n++) {
        if (storage[`lock_history:${n}`] === octraAddr) {
          userNonces.push(n);
        }
      }

      // 3. Build lock records with exact epochs
      const userLocks: LockRecord[] = [];
      for (let i = 0; i < lockTxs.length; i++) {
        if (cancelRef.current) throw new Error("Cancelled");
        const tx = lockTxs[i];
        const nonce = userNonces[i];
        if (!nonce) continue;
        const amount = BigInt(storage[`lock_amounts:${nonce}`] || "0");
        const ethRecipient = storage[`lock_eth_recipients:${nonce}`] || "";
        userLocks.push({
          nonce,
          epoch: tx.epoch,
          amount,
          amountHuman: (Number(amount) / 1e6).toFixed(6),
          ethRecipient,
          processed: false,
          status: "scanning",
        });
      }

      // 4. Check which locks are already processed on Ethereum
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
    async (lock: LockRecord) => {
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

        // 1. Check bridgeRootOf for the exact epoch
        const bridgeRoot = (await client.readContract({
          address: LATEST_EPOCH_CONTRACT,
          abi: LATEST_EPOCH_ABI,
          functionName: "bridgeRootOf",
          args: [BigInt(lock.epoch)],
        })) as `0x${string}`;

        if (bridgeRoot === ZERO_HASH) {
          throw new Error(
            `Epoch ${lock.epoch} has no bridge root on Ethereum. It may not be synced yet — try again later.`,
          );
        }

        // 2. Compute proof and verify match
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

        if (computedRoot !== bridgeRoot) {
          throw new Error(
            "Proof mismatch — this epoch may contain multiple TXs (needs merkle siblings).",
          );
        }

        // 3. Static call test before spending gas
        try {
          await client.simulateContract({
            address: BRIDGE_CONTRACT,
            abi: BRIDGE_ABI,
            functionName: "verifyAndMint",
            args: [BigInt(lock.epoch), msg, [], 0],
          });
        } catch (simErr) {
          const errStr = (simErr as Error).message || "";
          if (errStr.includes("a4875a49")) {
            throw new Error(
              "DailyMintCapExceeded — the bridge daily mint limit has been reached. Try again after UTC midnight.",
            );
          }
          throw new Error(`Static call failed: ${errStr.slice(0, 150)}`);
        }

        // 4. Call verifyAndMint via user's wallet
        const txHash = await writeContractAsync({
          address: BRIDGE_CONTRACT,
          abi: BRIDGE_ABI,
          functionName: "verifyAndMint",
          args: [BigInt(lock.epoch), msg, [], 0],
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
            : errMsg.includes("DailyMintCapExceeded")
              ? "Daily mint cap exceeded. Try again after UTC midnight."
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
