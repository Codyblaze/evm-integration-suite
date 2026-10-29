require("dotenv").config();
const { ethers } = require("ethers");
const readline = require("readline");
const fs = require("fs");

// ================= NETWORK & CONTRACT CONFIG =================
const RPC_URL = "https://rpc-testnet.kryvora.network";

const ROUTER_ADDRESS = "0x40e74982f63406e920d3384c4b9295085f72fe1c";
const WKETH_ADDRESS = "0x44f12d0487cd2efe2c572347578fc253e9b52e62";
const KALPHA_ADDRESS = "0x8956e3f2663e033edbc9656b7509d2657e34db00";

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Normalize structure to always have { name, privateKey }
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

async function main() {
  const wallets = loadWallets();
  const totalWallets = wallets.length;

  console.log(`\n================ KRYVORA SWAP BOT ================`);
  console.log(`Available Wallets:`);
  wallets.forEach((w, idx) => {
    console.log(`  [${idx + 1}] ${w.name}`);
  });
  console.log(`--------------------------------------------------`);

  const input = await promptUser(
    `Select wallets to run (e.g., "1,2", "1-3", or "all"): `
  );

  const selectedIndices = parseSelection(input, totalWallets);

  if (selectedIndices.length === 0) {
    console.log(`[✖] No valid wallets selected. Exiting.`);
    return;
  }

  console.log(`\n[+] Queued ${selectedIndices.length} wallet(s) for swap...`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
  const summary = [];

  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const target = wallets[idx];
    const wallet = new ethers.Wallet(target.privateKey, provider);

    const min = 0.000001;
    const max = 0.000005;
    const amountEth = (Math.random() * (max - min) + min).toFixed(8);
    const amountWei = ethers.parseEther(amountEth);

    console.log(`\n----------------------------------------------`);
    console.log(`[+] [${i + 1}/${selectedIndices.length}] ${target.name} (${wallet.address})`);
    console.log(`[+] Swap Amount: ${amountEth} ETH`);

    try {
      const path = [WKETH_ADDRESS, KALPHA_ADDRESS];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
      const slippageTolerance = 5n;

      const amountsOut = await router.getAmountsOut(amountWei, path);
      const expectedOut = amountsOut[1];
      const minOut = (expectedOut * (100n - slippageTolerance)) / 100n;

      const routerWithSigner = router.connect(wallet);
      const tx = await routerWithSigner.swapExactETHForTokens(
        minOut,
        path,
        wallet.address,
        deadline,
        {
          value: amountWei,
          gasLimit: 300000
        }
      );

      console.log(`[+] Broadcasted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`[✔] Confirmed in block ${receipt.blockNumber}`);

      summary.push({
        name: target.name,
        address: wallet.address,
        amount: amountEth,
        hash: receipt.hash,
        status: "SUCCESS"
      });
    } catch (err) {
      console.error(`[✖] Failed: ${err.reason || err.message}`);
      summary.push({
        name: target.name,
        address: wallet.address,
        amount: amountEth,
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
      Amount: `${s.amount} ETH`,
      Status: s.status,
      Hash: s.hash
    }))
  );

  console.log(`\n================ TRANSACTION HASHES ================\n`);
  const successHashes = summary.filter((s) => s.status === "SUCCESS");

  if (successHashes.length === 0) {
    console.log(`No successful transactions.\n`);
  } else {
    // Spaced out labeled hashes
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

