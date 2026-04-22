#!/usr/bin/env node
/**
 * Octra Bridge Recovery Script
 *
 * Scans all lock records on the Octra bridge contract,
 * finds any that belong to your wallet but haven't been minted on Ethereum,
 * and completes the verifyAndMint for each one.
 *
 * Usage:
 *   node scripts/recover.mjs
 *
 * Reads PK_OCTRA and PK_ETH from ../.env (relative to this script).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

// ── Setup noble ed25519 ──
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── Constants ──
const OCTRA_RPC = "https://octrascan.io/rpc";
const OCTRA_BRIDGE = "oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq";

const BRIDGE_CONTRACT = "0xe7ed69b852fd2a1406080b26a37e8e04e7da4cae";
const LATEST_EPOCH_CONTRACT = "0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d";

const SRC_CHAIN_ID = 7777n;
const DST_CHAIN_ID = 1n;
const SRC_BRIDGE_ID = "0x381ab73c25fb8d4ec4c03e15dd630fab75b410afd90a9276ab81df81c38d2a8b";
const DST_BRIDGE_ID = "0xab33480ea300316d03f76278f05f08f011d41d60f5d49c6ff6d8489fbd60c794";
const TOKEN_ID = "0x412ec1126381d672a9f42b8612e4bc9ee64f5b6467b991e61110203549cdd6de";

const ETH_RPCS = [
  "https://eth-mainnet.public.blastapi.io",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
];

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// ── ABIs ──
const BRIDGE_ABI = [
  {
    type: "function", name: "verifyAndMint", stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "uint64" },
      { name: "m", type: "tuple", components: [
        { name: "version", type: "uint8" }, { name: "direction", type: "uint8" },
        { name: "srcChainId", type: "uint64" }, { name: "dstChainId", type: "uint64" },
        { name: "srcBridgeId", type: "bytes32" }, { name: "dstBridgeId", type: "bytes32" },
        { name: "tokenId", type: "bytes32" }, { name: "recipient", type: "address" },
        { name: "amount", type: "uint128" }, { name: "srcNonce", type: "uint64" },
      ]},
      { name: "siblings", type: "bytes32[]" },
      { name: "leafIndex", type: "uint32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "hashBridgeLeaf", stateMutability: "pure",
    inputs: [{ name: "m", type: "tuple", components: [
      { name: "version", type: "uint8" }, { name: "direction", type: "uint8" },
      { name: "srcChainId", type: "uint64" }, { name: "dstChainId", type: "uint64" },
      { name: "srcBridgeId", type: "bytes32" }, { name: "dstBridgeId", type: "bytes32" },
      { name: "tokenId", type: "bytes32" }, { name: "recipient", type: "address" },
      { name: "amount", type: "uint128" }, { name: "srcNonce", type: "uint64" },
    ]}],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "hashBridgeMessage", stateMutability: "pure",
    inputs: [{ name: "m", type: "tuple", components: [
      { name: "version", type: "uint8" }, { name: "direction", type: "uint8" },
      { name: "srcChainId", type: "uint64" }, { name: "dstChainId", type: "uint64" },
      { name: "srcBridgeId", type: "bytes32" }, { name: "dstBridgeId", type: "bytes32" },
      { name: "tokenId", type: "bytes32" }, { name: "recipient", type: "address" },
      { name: "amount", type: "uint128" }, { name: "srcNonce", type: "uint64" },
    ]}],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "processBridgeProof", stateMutability: "pure",
    inputs: [
      { name: "leaf", type: "bytes32" },
      { name: "siblings", type: "bytes32[]" },
      { name: "index", type: "uint32" },
    ],
    outputs: [{ name: "h", type: "bytes32" }],
  },
  {
    type: "function", name: "processedMessages", stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
];

const LATEST_EPOCH_ABI = [
  { type: "function", name: "latestEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "bridgeRootOf", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "bytes32" }] },
];

// ── Helpers ──
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytesToBase58(bytes) {
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  const out = [];
  while (num > 0n) { out.push(BASE58[Number(num % 58n)]); num /= 58n; }
  for (const b of bytes) { if (b === 0) out.push(BASE58[0]); else break; }
  return out.reverse().join("");
}

function base64ToBytes(b64) {
  const bin = Buffer.from(b64.trim(), "base64");
  return new Uint8Array(bin);
}

function parsePrivateKey(input) {
  const s = input.trim();
  if (!s) throw new Error("Empty key");
  const hexBody = s.replace(/^0x/, "");
  if (/^[0-9a-fA-F]+$/.test(hexBody) && (hexBody.length === 64 || hexBody.length === 128)) {
    const out = new Uint8Array(hexBody.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hexBody.substr(i * 2, 2), 16);
    return out.slice(0, 32);
  }
  const b = base64ToBytes(s);
  if (b.length === 32 || b.length === 64) return b.slice(0, 32);
  throw new Error(`Invalid private key length: ${b.length}`);
}

function deriveOctraAddress(pkInput) {
  const seed = parsePrivateKey(pkInput);
  const pub = ed.getPublicKey(seed);
  const h = sha256(pub);
  return "oct" + bytesToBase58(h);
}

async function octraRpc(method, params = []) {
  const r = await fetch(OCTRA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!r.ok) throw new Error(`Octra RPC ${method} failed (${r.status})`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? `RPC error: ${method}`);
  return j.result;
}

function loadEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, "..", "..", ".env");
  const text = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──
async function main() {
  console.log("=== Octra Bridge Recovery ===\n");

  // 1. Load keys
  const env = loadEnv();
  const pkOctra = env.PK_OCTRA;
  const pkEth = env.PK_ETH;
  if (!pkOctra || !pkEth) {
    console.error("Missing PK_OCTRA or PK_ETH in .env");
    process.exit(1);
  }

  const octraAddr = deriveOctraAddress(pkOctra);
  console.log("Octra address:", octraAddr);

  const ethAccount = privateKeyToAccount(pkEth);
  console.log("ETH address:  ", ethAccount.address);

  // 2. Read bridge contract storage
  console.log("\nReading bridge contract storage...");
  const st = await octraRpc("contract_call", [OCTRA_BRIDGE, "version", []]);
  const storage = st.storage;
  const lockNonce = Number(storage.lock_nonce);
  console.log("Total locks:", lockNonce);

  // 3. Find user's locks
  const userLocks = [];
  for (let n = 1; n <= lockNonce; n++) {
    const sender = storage[`lock_history:${n}`];
    if (sender === octraAddr) {
      const amount = BigInt(storage[`lock_amounts:${n}`] || "0");
      const ethRecipient = storage[`lock_eth_recipients:${n}`] || "";
      userLocks.push({ nonce: n, amount, ethRecipient });
    }
  }

  if (userLocks.length === 0) {
    console.log("\nNo lock records found for your address.");
    return;
  }

  console.log(`\nFound ${userLocks.length} lock(s) for your address:`);
  for (const l of userLocks) {
    console.log(`  Lock #${l.nonce}: ${Number(l.amount) / 1e6} OCT → ${l.ethRecipient}`);
  }

  // 4. Setup Ethereum clients
  const publicClient = createPublicClient({ chain: mainnet, transport: http(ETH_RPCS[0]) });
  const walletClient = createWalletClient({
    account: ethAccount,
    chain: mainnet,
    transport: http(ETH_RPCS[0]),
  });

  // 5. Get latest epoch on Ethereum
  const latestEpoch = await publicClient.readContract({
    address: LATEST_EPOCH_CONTRACT,
    abi: LATEST_EPOCH_ABI,
    functionName: "latestEpoch",
  });
  console.log("\nLatest Ethereum epoch:", latestEpoch.toString());

  // 6. Check each lock
  let recoveredCount = 0;
  for (const lock of userLocks) {
    console.log(`\n--- Lock #${lock.nonce} (${Number(lock.amount) / 1e6} OCT → ${lock.ethRecipient}) ---`);

    const msg = {
      version: 1,
      direction: 0,
      srcChainId: SRC_CHAIN_ID,
      dstChainId: DST_CHAIN_ID,
      srcBridgeId: SRC_BRIDGE_ID,
      dstBridgeId: DST_BRIDGE_ID,
      tokenId: TOKEN_ID,
      recipient: lock.ethRecipient,
      amount: lock.amount,
      srcNonce: BigInt(lock.nonce),
    };

    // Check if already processed
    const msgHash = await publicClient.readContract({
      address: BRIDGE_CONTRACT,
      abi: BRIDGE_ABI,
      functionName: "hashBridgeMessage",
      args: [msg],
    });
    const processed = await publicClient.readContract({
      address: BRIDGE_CONTRACT,
      abi: BRIDGE_ABI,
      functionName: "processedMessages",
      args: [msgHash],
    });

    if (processed) {
      console.log("  Already processed on Ethereum. Skipping.");
      continue;
    }

    console.log("  NOT yet minted on Ethereum. Searching for matching epoch...");

    // Compute leaf hash
    const leaf = await publicClient.readContract({
      address: BRIDGE_CONTRACT,
      abi: BRIDGE_ABI,
      functionName: "hashBridgeLeaf",
      args: [msg],
    });
    const computedRoot = await publicClient.readContract({
      address: BRIDGE_CONTRACT,
      abi: BRIDGE_ABI,
      functionName: "processBridgeProof",
      args: [leaf, [], 0],
    });

    // Smart epoch search: start from user_last_lock_epoch hint, then expand
    let matchedEpoch = null;
    const lastLockEpochKey = `user_last_lock_epoch:${octraAddr}`;
    const hintEpoch = storage[lastLockEpochKey] ? Number(storage[lastLockEpochKey]) : Number(latestEpoch);
    const ethLatest = Number(latestEpoch);

    // Search ranges: around hint first, then broader
    const ranges = [
      [hintEpoch, Math.max(1, hintEpoch - 200)],
      [Math.min(ethLatest, hintEpoch + 200), hintEpoch + 1],
      [ethLatest, Math.max(1, ethLatest - 200)],
      [Math.max(1, hintEpoch - 200), Math.max(1, hintEpoch - 2000)],
    ];

    outer:
    for (const [start, end] of ranges) {
      const step = start >= end ? -1 : 1;
      for (let ep = start; step < 0 ? ep >= end : ep <= end; ep += step) {
        try {
          const root = await publicClient.readContract({
            address: LATEST_EPOCH_CONTRACT,
            abi: LATEST_EPOCH_ABI,
            functionName: "bridgeRootOf",
            args: [BigInt(ep)],
          });
          if (root === computedRoot && root !== ZERO_HASH) {
            matchedEpoch = ep;
            break outer;
          }
        } catch { /* skip */ }
      }
    }

    if (!matchedEpoch) {
      console.log("  Could not find matching epoch (searched ~2600 epochs around hint " + hintEpoch + ").");
      console.log("  This lock may require siblings (multi-message epoch) or is too old.");
      continue;
    }

    console.log(`  Found matching epoch: ${matchedEpoch}`);
    console.log("  Submitting verifyAndMint...");

    try {
      const hash = await walletClient.writeContract({
        address: BRIDGE_CONTRACT,
        abi: BRIDGE_ABI,
        functionName: "verifyAndMint",
        args: [BigInt(matchedEpoch), msg, [], 0],
      });

      console.log(`  TX submitted: ${hash}`);
      console.log("  Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        console.log(`  SUCCESS! wOCT minted. TX: https://etherscan.io/tx/${hash}`);
        recoveredCount++;
      } else {
        console.log(`  TX reverted. Check: https://etherscan.io/tx/${hash}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log(`\n=== Recovery complete. ${recoveredCount}/${userLocks.length} lock(s) recovered. ===`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
