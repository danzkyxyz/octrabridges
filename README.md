# Octra Bridge

**Free, fully client-side bridge from Octra to Ethereum.**  
No middleman, no fees — just gas. Your keys never leave the browser.

## Features

- **Bridge OCT → wOCT (Ethereum)** — Direct `verifyAndMint` call (no router, 0% fee)
- **Recover Stuck Locks** — Scan the Octra bridge contract for unprocessed locks and complete the mint on Ethereum
- **Non-custodial** — Sign Octra lock TX locally with `@noble/ed25519`, sign Ethereum TX with your own wallet (RainbowKit)
- **100% client-side** — No server, no SSR, no server functions

## Tech Stack

- **React 19** + **Vite 7**
- **wagmi v2** + **RainbowKit v2** (Ethereum wallet connection)
- **viem** (Ethereum RPC)
- **@noble/ed25519** + **@noble/hashes** (Octra signing)
- **Tailwind CSS v4** + **shadcn/ui**

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Recovery Script (CLI)

A standalone Node.js script to recover stuck bridge locks from the terminal:

```bash
# Create ../.env with your keys:
# PK_OCTRA="<base64 or hex>"
# PK_ETH="0x<hex private key>"

node scripts/recover.mjs
```

The script scans all lock records on the Octra bridge contract, identifies unprocessed ones belonging to your wallet, and attempts `verifyAndMint` on Ethereum for each.

## Contracts

| Chain    | Contract | Address |
|----------|----------|---------|
| Octra    | Bridge   | `oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq` |
| Ethereum | Bridge   | [`0xe7ed69b852fd2a1406080b26a37e8e04e7da4cae`](https://etherscan.io/address/0xe7ed69b852fd2a1406080b26a37e8e04e7da4cae) |
| Ethereum | wOCT     | [`0x4647e1fE715c9e23959022C2416C71867F5a6E80`](https://etherscan.io/address/0x4647e1fE715c9e23959022C2416C71867F5a6E80) |

## License

MIT
