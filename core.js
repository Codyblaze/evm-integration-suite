require("dotenv").config();
const { ethers } = require("ethers");
const readline = require("readline");
const fs = require("fs");
const nodeFetch = require("node-fetch");
const fetch = nodeFetch.default || nodeFetch;
const { HttpsProxyAgent } = require("https-proxy-agent");

// ================= NETWORK & DEX CONFIG =================
const RPC_URL = process.env.RPC_URL || "https://rpc-testnet.kryvora.network"; // Deprecated network
const ROUTER_ADDRESS = "0x40e74982f63406e920d3384c4b9295085f72fe1c";
const WKETH_ADDRESS = "0x44f12d0487cd2efe2c572347578fc253e9b52e62";
const KALPHA_ADDRESS = "0x8956e3f2663e033edbc9656b7509d2657e34db00";

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

// ================= API BASE CONFIG =================
const BASE_URL = "https://tasks.kryvora.network";
const HEADERS = {
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Origin": BASE_URL,
  "Referer": `${BASE_URL}/`,
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ================= WALLET & INPUT HELPERS =================
function loadWallets() {
  if (!fs.existsSync("./wallets.json")) {
    throw new Error("Missing wallets.json file.");
  }
  
  const rawData = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  
  return rawData.map((item, idx) => ({
    name: item.name || `Wallet_${idx + 1}`,
    privateKey: item.privateKey || item.key,
    proxy: item.proxy || null
  }));
}

function promptUser(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

function parseSelection(input, total) {
  if (input.toLowerCase() === "all") return Array.from({ length: total }, (_, i) => i);
  const selected = new Set();
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          if (i >= 1 && i <= total) selected.add(i - 1);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= total) selected.add(num - 1);
    }
  }
  return Array.from(selected).sort((a, b) => a - b);
}

// ================= WEB3 ON-CHAIN ACTION =================
async function executeSwap(wallet, router) {
  const min = 0.000001;
  const max = 0.000005;
  const amountEth = (Math.random() * (max - min) + min).toFixed(8);
  const amountWei = ethers.parseEther(amountEth);

  const path = [WKETH_ADDRESS, KALPHA_ADDRESS];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
  const slippageTolerance = 5n;

  const amountsOut = await router.getAmountsOut(amountWei, path);
  const minOut = (amountsOut[1] * (100n - slippageTolerance)) / 100n;

  const routerWithSigner = router.connect(wallet);
  const tx = await routerWithSigner.swapExactETHForTokens(
    minOut,
    path,
    wallet.address,
    deadline,
    { value: amountWei, gasLimit: 300000 }
  );

  console.log(`[+] Swap Broadcasted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[✔] Swap Confirmed in block ${receipt.blockNumber}`);
  return receipt.hash;
}

// ================= API BACKEND INTERACTIONS =================
async function authenticate(wallet, agent) {
  console.log(`[+] Authenticating with portal...`);
  const walletAddressLower = wallet.address.toLowerCase();

  const nonceRes = await fetch(`${BASE_URL}/api/auth/wallet/nonce`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ address: walletAddressLower }),
    agent: agent
  });
  
  const nonceText = await nonceRes.text();
  if (!nonceRes.ok || nonceText.startsWith("<!")) {
    throw new Error(`Nonce Fetch Failed (HTTP ${nonceRes.status}):\n${nonceText.slice(0, 60)}`);
  }
  
  const nonceData = JSON.parse(nonceText);
  let message = "";
  if (nonceData.message) {
    message = nonceData.message;
  } else {
    const nonce = nonceData.nonce || nonceData;
    const issuedAt = nonceData.issuedAt || new Date().toISOString();
    const expirationTime = nonceData.expirationTime || new Date(Date.now() + 5 * 60 * 1000).toISOString();
    message = `Kryvora Network login\n\nOrigin: https://tasks.kryvora.network\nChain ID: 0x4668b2c\nAddress: ${walletAddressLower}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
  }

  const signature = await wallet.signMessage(message);

  const verifyRes = await fetch(`${BASE_URL}/api/auth/wallet/verify`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ address: walletAddressLower, signature: signature }),
    agent: agent
  });

  const verifyText = await verifyRes.text();
  if (!verifyRes.ok || verifyText.startsWith("<!")) {
    throw new Error(`Verify Failed (HTTP ${verifyRes.status}):\n${verifyText}`);
  }

  const verifyData = JSON.parse(verifyText);
  const token = verifyData.token || verifyData.accessToken || (verifyRes.headers.get("authorization") || "").replace("Bearer ", "");

  if (!token) throw new Error(`Auth verification failed: ${JSON.stringify(verifyData)}`);
  return token;
}

async function handleCheckin(token, agent) {
  console.log(`[+] Attempting Pinging Authenticated Endpoint`);
  try {
    const verifyRes = await fetch(`${BASE_URL}/api/portal/quests/quest-daily-gm/verify`, {
      method: "POST",
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
      agent: agent
    });
    
    if (!verifyRes.ok) {
      console.log(`[!] Pinging Authenticated Endpoint Verify Skipped/Already Done.`);
      return;
    }

    await sleep(1500);

    const claimRes = await fetch(`${BASE_URL}/api/portal/quests/quest-daily-gm/claim`, {
      method: "POST",
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
      agent: agent
    });
    
    if (claimRes.ok) {
      console.log(`[✔] Pinging Authenticated Endpoint: Successfully Claimed`);
    } else {
      console.log(`[!] Pinging Authenticated Endpoint Failed.`);
    }
  } catch (err) {
    console.log(`[✖] Check-in Error:`, err.message);
  }
}

async function verifyAndClaimSwap(token, txHash, agent) {
  console.log(`[+] Submitting proof for Simulating DEX Swap task...`);
  const verifyRes = await fetch(`${BASE_URL}/api/portal/quests/quest-daily-swap/verify`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ txHash: txHash }),
    agent: agent
  });
  
  await sleep(1500);

  const claimRes = await fetch(`${BASE_URL}/api/portal/quests/quest-daily-swap/claim`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
    agent: agent
  });

  const claimData = await claimRes.json();
  console.log(`[✔] Swap Task Claim Status:`, claimData.message || "Completed");
}

// ================= MAIN RUNNER =================
async function main() {
  const wallets = loadWallets();
  const totalWallets = wallets.length;

  console.log(`\n================ EVM NETWORK STRESS-TEST & AUTH SUITE ================`);
  wallets.forEach((w, idx) => console.log(`  [${idx + 1}] ${w.name} ${w.proxy ? '(Proxied)' : '(Direct)'}`));
  console.log(`--------------------------------------------------------`);

  const input = await promptUser(`Select wallets to run (e.g., "1,2", "1-3", or "all"): `);
  const selectedIndices = parseSelection(input, totalWallets);

  if (selectedIndices.length === 0) {
    console.log(`[✖] No valid wallets selected. Exiting.`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
  const summary = [];

  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const target = wallets[idx];
    const wallet = new ethers.Wallet(target.privateKey, provider);
    const agent = target.proxy ? new HttpsProxyAgent(target.proxy) : null;

    console.log(`\n--------------------------------------------------------`);
    console.log(`[+] [${i + 1}/${selectedIndices.length}] Processing ${target.name} (${wallet.address})`);

    let swapStatus = "FAILED";
    let checkinStatus = "FAILED";
    let txHash = "FAILED";

    try {
      txHash = await executeSwap(wallet, router);
      swapStatus = "SUCCESS";
      
      console.log(`[i] Waiting 5s for block indexing...`);
      await sleep(5000);

      const token = await authenticate(wallet, agent);
      await handleCheckin(token, agent);
      checkinStatus = "SUCCESS";

      await verifyAndClaimSwap(token, txHash, agent);

      summary.push({ name: target.name, address: wallet.address, hash: txHash, Swap: swapStatus, Checkin: checkinStatus, Status: "COMPLETED" });
    } catch (err) {
      console.error(`[✖] Error processing ${target.name}:`, err.message);
      summary.push({ name: target.name, address: wallet.address, hash: txHash, Swap: swapStatus, Checkin: checkinStatus, Status: "FAILED" });
    }

    if (i < selectedIndices.length - 1) {
      console.log(`[i] Sleeping 5s before next wallet...`);
      await sleep(5000);
    }
  }

  console.log(`\n======================= SUMMARY =======================`);
  console.table(summary);
  console.log(`\n====================================================\n`);
}

main();