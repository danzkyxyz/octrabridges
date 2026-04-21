/**
 * Ethereum-side ABIs (subset of bridge contract).
 * Direct call to verifyAndMint on the bridge contract (NO router) → 0% fee.
 */
export const BRIDGE_ABI = [
  {
    type: "function",
    name: "verifyAndMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "uint64" },
      {
        name: "m",
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "direction", type: "uint8" },
          { name: "srcChainId", type: "uint64" },
          { name: "dstChainId", type: "uint64" },
          { name: "srcBridgeId", type: "bytes32" },
          { name: "dstBridgeId", type: "bytes32" },
          { name: "tokenId", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint128" },
          { name: "srcNonce", type: "uint64" },
        ],
      },
      { name: "siblings", type: "bytes32[]" },
      { name: "leafIndex", type: "uint32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "hashBridgeLeaf",
    stateMutability: "pure",
    inputs: [
      {
        name: "m",
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "direction", type: "uint8" },
          { name: "srcChainId", type: "uint64" },
          { name: "dstChainId", type: "uint64" },
          { name: "srcBridgeId", type: "bytes32" },
          { name: "dstBridgeId", type: "bytes32" },
          { name: "tokenId", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint128" },
          { name: "srcNonce", type: "uint64" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "hashBridgeMessage",
    stateMutability: "pure",
    inputs: [
      {
        name: "m",
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "direction", type: "uint8" },
          { name: "srcChainId", type: "uint64" },
          { name: "dstChainId", type: "uint64" },
          { name: "srcBridgeId", type: "bytes32" },
          { name: "dstBridgeId", type: "bytes32" },
          { name: "tokenId", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint128" },
          { name: "srcNonce", type: "uint64" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "processBridgeProof",
    stateMutability: "pure",
    inputs: [
      { name: "leaf", type: "bytes32" },
      { name: "siblings", type: "bytes32[]" },
      { name: "index", type: "uint32" },
    ],
    outputs: [{ name: "h", type: "bytes32" }],
  },
  {
    type: "function",
    name: "processedMessages",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const LATEST_EPOCH_ABI = [
  {
    type: "function",
    name: "latestEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "bridgeRootOf",
    stateMutability: "view",
    inputs: [{ type: "uint64" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
