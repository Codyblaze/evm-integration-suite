require("dotenv").config();
const { ethers } = require("ethers");
const readline = require("readline");
const fs = require("fs");

// ================= NETWORK CONFIG =================
const RPC_URL = "https://rpc-testnet.kryvora.network";

// Ultra-minimal Solidity contract (KryvoraTest)
// Matches standard storage deploy without string overhead
const CONTRACT_ABI = ["constructor()"];
const CONTRACT_BYTECODE = "0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220c3a8e9e1c15f2bf9478f7e34ef32230a1bf6f16cb030a51e604f5e73ef5e058664736f6c63430008140033";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ================= HELPERS =================

function loadWallets() {
  let rawData = [];

  if (fs.existsSync("./wallets.json")) {
    rawData = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  } else if (process.env.PRIVATE_KEYS) {
    try {
      rawData = JSON.parse(process.env.PRIVATE_KEYS);
    } catch (e) {
      console.error("[✖] Error parsing PRIVATE_KEYS from .env");
    }
  }

  if (!rawData || rawData.length === 0) {
    throw new Error("No wallets found in wallets.json or .env");
  }

  return rawData.map((item, idx) => {
    if (typeof item === "string") {
      return { name: `Wallet_${idx + 1}`, privateKey: item };
    }
    return {
      name: item.name || `Wallet_${idx + 1}`,
      privateKey: item.privateKey || item.key
    };
  });
}

function promptUser(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function parseSelection(input, total) {
  if (input.toLowerCase() === "all") {
    return Array.from({ length: total }, (_, i) => i);
  }

  const selected = new Set();
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const lower = Math.min(start, end);
        const upper = Math.max(start, end);
        for (let i = lower; i <= upper; i++) {
          if (i >= 1 && i <= total) selected.add(i - 1);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= total) {
        selected.add(num - 1);
      }
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

// ================= EXECUTION =================

async function main() {
  const wallets = loadWallets();
  const totalWallets = wallets.length;

  console.log(`\n================ KRYVORA CONTRACT DEPLOYER ================`);
  console.log(`Available Wallets:`);
  wallets.forEach((w, idx) => {
    console.log(`  [${idx + 1}] ${w.name}`);
  });
  console.log(`-----------------------------------------------------------`);

  const input = await promptUser(
    `Select wallets to deploy from (e.g., "1,2", "1-3", or "all"): `
  );

  const selectedIndices = parseSelection(input, totalWallets);

  if (selectedIndices.length === 0) {
    console.log(`[✖] No valid wallets selected. Exiting.`);
    return;
  }

  console.log(`\n[+] Queued ${selectedIndices.length} wallet(s) for deployment...`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const summary = [];

  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const target = wallets[idx];
    const wallet = new ethers.Wallet(target.privateKey, provider);

    console.log(`\n-----------------------------------------------------------`);
    console.log(`[+] [${i + 1}/${selectedIndices.length}] Deploying with ${target.name} (${wallet.address})`);

    try {
      const factory = new ethers.ContractFactory(CONTRACT_ABI, CONTRACT_BYTECODE, wallet);
      
      // Increased gasLimit headroom to avoid out-of-gas errors
      const contract = await factory.deploy({ gasLimit: 2000000 });
      const deployTx = contract.deploymentTransaction();

      console.log(`[+] Broadcasted TX: ${deployTx.hash}`);
      await contract.waitForDeployment();
      const deployedAddress = await contract.getAddress();

      console.log(`[✔] Deployed to Address: ${deployedAddress}`);

      summary.push({
        name: target.name,
        address: wallet.address,
        contractAddress: deployedAddress,
        hash: deployTx.hash,
        status: "SUCCESS"
      });
    } catch (err) {
      console.error(`[✖] Deployment Failed: ${err.reason || err.message}`);
      summary.push({
        name: target.name,
        address: wallet.address,
        contractAddress: "N/A",
        hash: "FAILED",
        status: "FAILED"
      });
    }

    if (i < selectedIndices.length - 1) {
      console.log(`[i] Sleeping 3s...`);
      await sleep(3000);
    }
  }

  // ================= SUMMARY OUTPUT =================

  console.log(`\n======================= SUMMARY =======================`);
  console.table(
    summary.map((s) => ({
      Wallet: s.name,
      Address: s.address,
      Status: s.status,
      Contract: s.contractAddress,
      Hash: s.hash
    }))
  );

  console.log(`\n================ TRANSACTION HASHES ================\n`);
  const successHashes = summary.filter((s) => s.status === "SUCCESS");

  if (successHashes.length === 0) {
    console.log(`No successful deployments.\n`);
  } else {
    successHashes.forEach((s) => {
      console.log(`${s.name}:\n${s.hash}\n`);
    });

    console.log(`----------------------------------------------------\n`);
    console.log(`--- Raw Hashes (Double-Spaced for Easy Selection) ---\n`);
    console.log(successHashes.map((s) => s.hash).join("\n\n"));
    console.log("\n");
  }
  console.log(`====================================================\n`);
}

main();

