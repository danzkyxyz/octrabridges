/**
 * Octra wallet client: address derivation + RPC + lock TX signing.
 * Pure browser code — uses @noble/ed25519.
 */
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { OCTRA_RPC, OCTRA_BRIDGE_CONTRACT } from "./constants";

// @noble/ed25519 v2 needs sync sha512 wired up
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytesToBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  const out: string[] = [];
  while (num > 0n) {
    const rem = Number(num % 58n);
    num /= 58n;
    out.push(BASE58[rem]);
  }
  for (const b of bytes) {
    if (b === 0) out.push(BASE58[0]);
    else break;
  }
  return out.reverse().join("");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Parse Octra private key from multiple formats and return the 32-byte seed:
 *  - 32-byte base64 seed (e.g. "AAAA…")
 *  - 64-byte base64 (seed || pubkey) — common from CLI/wallet exports
 *  - 32 or 64-byte hex (with or without 0x prefix)
 */
export function parsePrivateKey(input: string): Uint8Array {
  const s = input.trim();
  if (!s) throw new Error("Empty key");

  const hexBody = s.replace(/^0x/, "");
  if (/^[0-9a-fA-F]+$/.test(hexBody) && (hexBody.length === 64 || hexBody.length === 128)) {
    return hexToBytes(s).slice(0, 32);
  }

  let b: Uint8Array;
  try {
    b = base64ToBytes(s);
  } catch {
    throw new Error("Invalid key (not valid base64 or hex)");
  }
  if (b.length === 32 || b.length === 64) return b.slice(0, 32);
  throw new Error(
    `Invalid private key length: ${b.length} bytes (expected 32 or 64)`,
  );
}

export function derivePublicKey(pkInput: string): Uint8Array {
  const seed = parsePrivateKey(pkInput);
  return ed.getPublicKey(seed);
}

export function deriveOctraAddress(pkInput: string): string {
  const pub = derivePublicKey(pkInput);
  const h = sha256(pub);
  return "oct" + bytesToBase58(h);
}

export interface OctraBalance {
  address: string;
  balance: string; // human, e.g. "12.345"
  balance_raw: bigint; // micro-units
  nonce: number;
  pending_nonce: number;
}

export async function octraRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await fetch(OCTRA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!r.ok) throw new Error(`Octra RPC ${method} failed (${r.status})`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? `RPC error: ${method}`);
  return j.result as T;
}

export async function getOctraBalance(address: string): Promise<OctraBalance> {
  const r = await octraRpc<{
    balance: string;
    balance_raw: string;
    nonce: number;
    pending_nonce?: number;
  }>("octra_balance", [address]);
  return {
    address,
    balance: r.balance,
    balance_raw: BigInt(r.balance_raw),
    nonce: Number(r.nonce),
    pending_nonce: Number(r.pending_nonce ?? r.nonce),
  };
}

/**
 * Build & sign a "lock_to_eth" call to the Octra bridge contract.
 * recipient = the Ethereum address that should receive wOCT (NO router → fee 0%).
 */
export async function buildLockTx(
  pkB64: string,
  sender: string,
  nonce: number,
  amountRaw: bigint,
  ethRecipient: string,
) {
  const seed = base64ToBytes(pkB64);
  const pub = await ed.getPublicKeyAsync(seed);

  const core: Record<string, unknown> = {
    from: sender,
    to_: OCTRA_BRIDGE_CONTRACT,
    amount: amountRaw.toString(),
    nonce,
    ou: "1000",
    timestamp: Date.now() / 1000,
    op_type: "call",
    encrypted_data: "lock_to_eth",
    message: JSON.stringify([ethRecipient]),
  };

  const msg = new TextEncoder().encode(JSON.stringify(core));
  const sig = await ed.signAsync(msg, seed);

  return {
    ...core,
    signature: bytesToBase64(sig),
    public_key: bytesToBase64(pub),
  };
}

export async function submitOctraTx(tx: unknown): Promise<string> {
  const r = await octraRpc<{ tx_hash: string }>("octra_submit", [tx]);
  return r.tx_hash;
}

export interface OctraTxStatus {
  status: string;
  epoch?: number;
}
export async function getOctraTx(hash: string): Promise<OctraTxStatus | null> {
  try {
    return await octraRpc<OctraTxStatus>("octra_transaction", [hash]);
  } catch {
    return null;
  }
}

/** Read bridge contract storage to find our lock_nonce. */
export async function findLockNonce(
  sender: string,
  ethRecipient: string,
  amountRaw: bigint,
): Promise<{ lockNonce: number; amountRaw: bigint } | null> {
  const st = await octraRpc<{ storage: { lock_nonce: string | number } }>(
    "contract_call",
    [OCTRA_BRIDGE_CONTRACT, "version", []],
  );
  const cln = Number(st.storage.lock_nonce);
  const targetRecipient = ethRecipient.toLowerCase();

  for (let n = cln; n > Math.max(0, cln - 30); n--) {
    try {
      const info = await octraRpc<{ result: string }>("contract_call", [
        OCTRA_BRIDGE_CONTRACT,
        "get_lock_info",
        [String(n)],
      ]);
      const res = info?.result ?? "";
      if (!res) continue;
      const [s, a, r] = res.split("|");
      if (s === sender && r?.toLowerCase() === targetRecipient) {
        return { lockNonce: n, amountRaw: BigInt(a) };
      }
    } catch {
      /* keep scanning */
    }
  }
  return null;
}
