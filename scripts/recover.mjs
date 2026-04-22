#!/usr/bin/env node
/**
 * Octra Bridge Recovery Script
 *
 * 1. Fetches all lock_to_eth TXs from Octra for your address (with exact epochs)
 * 2. Checks which are already processed on Ethereum
 * 3. For unprocessed: verifies proof, checks daily mint cap, waits if needed, mints
 *
 * Usage:
 *   node scripts/recover.mjs
 *
 * Reads PK_OCTRA and PK_ETH from ../../.env (relative to this script).
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
const LIGHT_CLIENT = "0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d";
const WOCT_TOKEN = "0x4647e1fE715c9e23959022C2416C71867F5a6E80";

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

// DailyMintCapExceeded() selector
const DAILY_CAP_ERROR = "0xa4875a49";

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
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "mintCapPerTx", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mintCapDaily", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mintedToday", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "outstandingSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const LC_ABI = [
  { type: "function", name: "latestEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "bridgeRootOf", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "headerIdByEpoch", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "bytes32" }] },
];

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
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
  return new Uint8Array(Buffer.from(b64.trim(), "base64"));
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

function hoursUntilUTCReset() {
  const now = new Date();
  const nextUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return (nextUTC - now) / 3600000;
}

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

  // 2. Fetch ALL lock_to_eth TXs from Octra (with epochs)
  console.log("\nFetching transaction history from Octra...");
  const txHistory = await octraRpc("octra_transactionsByAddress", [octraAddr]);
  const lockTxs = (txHistory.transactions || []).filter(
    (tx) => tx.encrypted_data === "lock_to_eth" && (tx.to_ || tx.to) === OCTRA_BRIDGE,
  );

  if (lockTxs.length === 0) {
    console.log("No lock_to_eth transactions found.");
    return;
  }

  // 3. Read bridge contract storage to map nonces
  console.log("Reading bridge contract storage...");
  const st = await octraRpc("contract_call", [OCTRA_BRIDGE, "version", []]);
  const storage = st.storage;
  const lockNonce = Number(storage.lock_nonce);

  // Build nonce → lock info map
  const userNonces = [];
  for (let n = 1; n <= lockNonce; n++) {
    if (storage[`lock_history:${n}`] === octraAddr) {
      userNonces.push(n);
    }
  }

  // Match lock TXs to nonces by amount + recipient
  // Sort lockTxs by epoch ascending (oldest first) to match nonce order
  lockTxs.sort((a, b) => a.epoch - b.epoch);
  const locks = [];
  for (let i = 0; i < lockTxs.length; i++) {
    const tx = lockTxs[i];
    const nonce = userNonces[i]; // nonces are assigned in order
    if (!nonce) continue;
    const amount = BigInt(storage[`lock_amounts:${nonce}`] || "0");
    const ethRecipient = storage[`lock_eth_recipients:${nonce}`] || "";
    let msg;
    try { msg = JSON.parse(tx.message); } catch { msg = []; }
    locks.push({
      nonce,
      epoch: tx.epoch,
      txHash: tx.hash,
      amount,
      ethRecipient,
      msgRecipient: msg[0] || ethRecipient,
    });
  }

  console.log(`\nFound ${locks.length} lock(s) with epochs:`);
  for (const l of locks) {
    console.log(`  Lock #${l.nonce}: ${Number(l.amount) / 1e6} OCT → ${l.ethRecipient} (epoch ${l.epoch})`);
  }

  // 4. Setup Ethereum clients
  const pub = createPublicClient({ chain: mainnet, transport: http(ETH_RPCS[0]) });
  const wallet = createWalletClient({
    account: ethAccount,
    chain: mainnet,
    transport: http(ETH_RPCS[0]),
  });

  // 5. Check bridge state
  console.log("\n=== Ethereum Bridge State ===");
  const [latestEpoch, paused, mintCapPerTx, mintCapDaily, mintedToday] = await Promise.all([
    pub.readContract({ address: LIGHT_CLIENT, abi: LC_ABI, functionName: "latestEpoch" }),
    pub.readContract({ address: BRIDGE_CONTRACT, abi: BRIDGE_ABI, functionName: "paused" }),
    pub.readContract({ address: BRIDGE_CONTRACT, abi: BRIDGE_ABI, functionName: "mintCapPerTx" }),
    pub.readContract({ address: BRIDGE_CONTRACT, abi: BRIDGE_ABI, functionName: "mintCapDaily" }),
    pub.readContract({ address: BRIDGE_CONTRACT, abi: BRIDGE_ABI, functionName: "mintedToday" }),
  ]);
  console.log(`  Latest epoch:   ${latestEpoch}`);
  console.log(`  Paused:         ${paused}`);
  console.log(`  Mint cap/tx:    ${Number(mintCapPerTx) / 1e6} OCT`);
  console.log(`  Mint cap/day:   ${Number(mintCapDaily) / 1e6} OCT`);
  console.log(`  Minted today:   ${Number(mintedToday) / 1e6} OCT`);
  const dailyRemaining = Number(mintCapDaily) - Number(mintedToday);
  console.log(`  Daily remaining: ${dailyRemaining / 1e6} OCT`);

  if (paused) {
    console.error("\nBridge is PAUSED. Cannot mint.");
    process.exit(1);
  }

  const ethBal = await pub.getBalance({ address: ethAccount.address });
  console.log(`\n  ETH balance: ${Number(ethBal) / 1e18} ETH`);

  // 6. Process each lock
  let recoveredCount = 0;
  for (const lock of locks) {
    console.log(`\n--- Lock #${lock.nonce} (${Number(lock.amount) / 1e6} OCT → ${lock.ethRecipient}, epoch ${lock.epoch}) ---`);

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
    const msgHash = await pub.readContract({
      address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
      functionName: "hashBridgeMessage", args: [msg],
    });
    const processed = await pub.readContract({
      address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
      functionName: "processedMessages", args: [msgHash],
    });

    if (processed) {
      console.log("  ✓ Already processed on Ethereum.");
      continue;
    }

    console.log("  ✗ NOT yet minted on Ethereum.");

    // Check if epoch is available on light client
    const headerId = await pub.readContract({
      address: LIGHT_CLIENT, abi: LC_ABI,
      functionName: "headerIdByEpoch", args: [BigInt(lock.epoch)],
    });
    const bridgeRoot = await pub.readContract({
      address: LIGHT_CLIENT, abi: LC_ABI,
      functionName: "bridgeRootOf", args: [BigInt(lock.epoch)],
    });

    console.log(`  headerIdByEpoch(${lock.epoch}): ${headerId.slice(0, 18)}...`);
    console.log(`  bridgeRootOf(${lock.epoch}):     ${bridgeRoot.slice(0, 18)}...`);

    if (bridgeRoot === ZERO_HASH) {
      if (BigInt(lock.epoch) > latestEpoch) {
        console.log(`  Epoch ${lock.epoch} not yet synced (latest=${latestEpoch}). Waiting...`);
        let synced = false;
        for (let i = 0; i < 60; i++) {
          await sleep(10_000);
          const cur = await pub.readContract({ address: LIGHT_CLIENT, abi: LC_ABI, functionName: "latestEpoch" });
          process.stdout.write(`\r  [${i + 1}/60] Latest: ${cur}, need: ${lock.epoch}`);
          if (cur >= BigInt(lock.epoch)) {
            synced = true;
            console.log(" ✓");
            break;
          }
        }
        if (!synced) {
          console.log("\n  Timeout waiting for epoch sync. Skip.");
          continue;
        }
        // Re-fetch bridgeRoot
        const newRoot = await pub.readContract({
          address: LIGHT_CLIENT, abi: LC_ABI,
          functionName: "bridgeRootOf", args: [BigInt(lock.epoch)],
        });
        if (newRoot === ZERO_HASH) {
          console.log("  Bridge root still empty after sync. Epoch has no bridge data. Skip.");
          continue;
        }
      } else {
        console.log("  Bridge root is EMPTY. This epoch may not have bridge data. Skip.");
        continue;
      }
    }

    // Compute proof
    const leaf = await pub.readContract({
      address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
      functionName: "hashBridgeLeaf", args: [msg],
    });
    const computedRoot = await pub.readContract({
      address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
      functionName: "processBridgeProof", args: [leaf, [], 0],
    });

    // Re-fetch bridgeRoot for this epoch
    const rootNow = await pub.readContract({
      address: LIGHT_CLIENT, abi: LC_ABI,
      functionName: "bridgeRootOf", args: [BigInt(lock.epoch)],
    });

    console.log(`  Leaf:         ${leaf.slice(0, 18)}...`);
    console.log(`  ComputedRoot: ${computedRoot.slice(0, 18)}...`);
    console.log(`  BridgeRoot:   ${rootNow.slice(0, 18)}...`);
    console.log(`  MATCH: ${computedRoot === rootNow}`);

    if (computedRoot !== rootNow) {
      console.log("  Proof mismatch. Epoch may have multiple TXs (need siblings). Skip.");
      continue;
    }

    // Static call test before spending gas
    console.log("  Testing with static call...");
    try {
      await pub.simulateContract({
        address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
        functionName: "verifyAndMint",
        args: [BigInt(lock.epoch), msg, [], 0],
        account: ethAccount.address,
      });
      console.log("  Static call SUCCESS!");
    } catch (e) {
      const errStr = e.message || "";
      if (errStr.includes(DAILY_CAP_ERROR) || errStr.includes("a4875a49")) {
        const hrs = hoursUntilUTCReset();
        console.log(`  DailyMintCapExceeded! Resets in ~${hrs.toFixed(1)} hours.`);
        console.log("  Waiting for UTC day reset...");
        const waitMs = Math.ceil(hrs * 3600000) + 60_000; // +1 min buffer
        const waitMins = Math.ceil(waitMs / 60000);
        for (let m = 0; m < waitMins; m++) {
          await sleep(60_000);
          process.stdout.write(`\r  Waiting... ${waitMins - m - 1} min remaining`);
        }
        console.log("\n  Retrying static call...");
        try {
          await pub.simulateContract({
            address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
            functionName: "verifyAndMint",
            args: [BigInt(lock.epoch), msg, [], 0],
            account: ethAccount.address,
          });
          console.log("  Static call SUCCESS after cap reset!");
        } catch (e2) {
          console.log(`  Still failing: ${e2.message?.slice(0, 120)}`);
          continue;
        }
      } else {
        console.log(`  Static call FAILED: ${errStr.slice(0, 200)}`);
        continue;
      }
    }

    // Send real transaction
    console.log("  Sending verifyAndMint transaction...");
    try {
      const txHash = await wallet.writeContract({
        address: BRIDGE_CONTRACT, abi: BRIDGE_ABI,
        functionName: "verifyAndMint",
        args: [BigInt(lock.epoch), msg, [], 0],
      });
      console.log(`  TX: https://etherscan.io/tx/${txHash}`);
      console.log("  Waiting for confirmation...");

      const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 300_000 });
      if (receipt.status === "success") {
        console.log(`  ✓ SUCCESS! Gas used: ${receipt.gasUsed}`);

        // Check wOCT balance
        const woctBal = await pub.readContract({
          address: WOCT_TOKEN, abi: ERC20_ABI,
          functionName: "balanceOf", args: [lock.ethRecipient],
        });
        console.log(`  wOCT balance at ${lock.ethRecipient}: ${Number(woctBal) / 1e6}`);
        recoveredCount++;
      } else {
        console.log(`  ✗ TX reverted. Check: https://etherscan.io/tx/${txHash}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message?.slice(0, 200)}`);
    }
  }

  console.log(`\n=== Recovery complete. ${recoveredCount}/${locks.length} lock(s) recovered. ===`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
