import { type Address } from "viem";
export const auctionAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "verifier_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "CAPACITY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createAuction",
    "inputs": [
      {
        "name": "rules",
        "type": "tuple",
        "internalType": "struct PrivateAuction.Rules",
        "components": [
          {
            "name": "seller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "itemHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "destinationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reserve",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxAmount",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "closesAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalizationWindow",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "paymentWindow",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "evaluatorKeyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "drandChainHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "drandRound",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "domainSeparator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expireAuction",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeAuction",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct PrivateAuction.Result",
        "components": [
          {
            "name": "sale",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "winnerIndex",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "winnerIdentity",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAuction",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PrivateAuction.Auction",
        "components": [
          {
            "name": "rules",
            "type": "tuple",
            "internalType": "struct PrivateAuction.Rules",
            "components": [
              {
                "name": "seller",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "itemHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "destinationHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "reserve",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "maxAmount",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "closesAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalizationWindow",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "paymentWindow",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "evaluatorKeyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "drandChainHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "drandRound",
                "type": "uint64",
                "internalType": "uint64"
              }
            ]
          },
          {
            "name": "rulesHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "count",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "winnerIndex",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "winnerIdentity",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalizedAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getBids",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct PrivateAuction.Bid[]",
        "components": [
          {
            "name": "bidder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "commitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "ciphertextHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextAuctionId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "publicInputs",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct PrivateAuction.Result",
        "components": [
          {
            "name": "sale",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "winnerIndex",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "winnerIdentity",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "p",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registerBid",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bidder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "commitment",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "ciphertextHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAuctionVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AuctionCreated",
    "inputs": [
      {
        "name": "auctionId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "seller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rulesHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AuctionExpired",
    "inputs": [
      {
        "name": "auctionId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AuctionFinalized",
    "inputs": [
      {
        "name": "auctionId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "sale",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "winnerIndex",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "winnerIdentity",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BidRegistered",
    "inputs": [
      {
        "name": "auctionId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "index",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "bidder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitment",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "ciphertextHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyTerminal",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CapacityReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Closed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRules",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnknownAuction",
    "inputs": []
  }
] as const;
export const BASE_SEPOLIA_CHAIN_ID=84532;
export type AuctionContractAddress = Address;
