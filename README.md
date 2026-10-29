# EVM Integration & SIWE Authentication Suite

A lightweight Node.js framework designed to demonstrate end-to-end interactions between Ethereum Virtual Machine (EVM) smart contracts and Web2 REST APIs. 

This toolkit simulates multi-wallet network activity, executing automated decentralized exchange (DEX) swaps and securely authenticating with off-chain backends using cryptographic signatures.

## Core Features

* **Sign-In With Ethereum (SIWE):** Programmatically constructs, formats, and signs standard SIWE messages using private keys to request off-chain JWT session tokens.
* **Automated DEX Routing:** Interacts directly with Uniswap V2-style router contracts to dynamically calculate slippage and execute `swapExactETHForTokens` transactions.
* **Network Isolation:** Utilizes `https-proxy-agent` to route individual wallet instances through isolated HTTP proxies, simulating diverse, decentralized network origins.
* **Asynchronous State Management:** Handles blockchain latency, block indexing delays, and sequential REST API interactions (nonce requests, verification, and authenticated POST payloads) seamlessly.

## Tech Stack
* **Node.js / Ethers.js v6** for blockchain cryptography and RPC communication.
* **Node-Fetch** for backend API interactions.
* **Solidity ABI** implementation for router interaction.

## Architecture

1. **On-Chain Execution:** The script initializes an RPC provider and connects a wallet signer to the DEX router, calculating minimum output amounts before broadcasting the swap.
2. **Indexing Buffer:** Awaits block confirmation and network indexing.
3. **Cryptographic Auth:** Fetches a dynamic server nonce, builds the exact SIWE payload, and signs it via the elliptical curve `secp256k1` signature scheme.
4. **Authenticated Requests:** Attaches the resulting Bearer token to subsequent backend API requests to verify the transaction hash and simulate authenticated user sessions.

## Disclaimer
This codebase was originally developed as an integration test for a custom Layer 2 testnet (now deprecated). It serves as an educational blueprint for integrating Ethers.js scripts with Web2 authorization walls.
