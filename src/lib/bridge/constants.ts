/**
 * Bridge constants — derived from server.py.
 * Bypasses the 15% router (0xB8de...F6Ff) by calling the bridge contract directly.
 */
export const OCTRA_RPC = "https://octrascan.io/rpc";

export const ETH_RPCS = [
  "https://eth-mainnet.public.blastapi.io",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
] as const;

// Octra-side bridge contract address (where we lock OCT)
export const OCTRA_BRIDGE_CONTRACT = "oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq";

// Ethereum-side contracts
export const BRIDGE_CONTRACT = "0xe7ed69b852fd2a1406080b26a37e8e04e7da4cae" as const; // EthereumBridge (verifyAndMint)
export const WOCT_TOKEN = "0x4647e1fE715c9e23959022C2416C71867F5a6E80" as const;
export const LATEST_EPOCH_CONTRACT = "0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d" as const;

// Bridge message struct constants (from server.py _S1, _S2, _S3)
export const SRC_CHAIN_ID = 7777n;
export const DST_CHAIN_ID = 1n;
export const SRC_BRIDGE_ID = "0x381ab73c25fb8d4ec4c03e15dd630fab75b410afd90a9276ab81df81c38d2a8b" as const;
export const DST_BRIDGE_ID = "0xab33480ea300316d03f76278f05f08f011d41d60f5d49c6ff6d8489fbd60c794" as const;
export const TOKEN_ID = "0x412ec1126381d672a9f42b8612e4bc9ee64f5b6467b991e61110203549cdd6de" as const;

// Donation address
export const DONATION_ADDRESS = "0x2b5651c9952C0E24d7666fC984BF8543b7142D02" as const;

// 1 OCT = 1e6 micro
export const OCT_DECIMALS = 6;
export const OCT_UNIT = 1_000_000n;

// Reserve for fees on Octra side (0.001 OCT)
export const OCTRA_FEE_RESERVE = 1_000n;
