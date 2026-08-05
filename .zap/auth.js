const { Keypair, TransactionBuilder, Networks } = require("@stellar/stellar-sdk");
const http = require("http");

const TARGET_URL = process.env.TARGET_URL || "http://localhost:4000";
const NETWORK_PASSPHRASE = Networks.TESTNET;

async function authenticate() {
  try {
    // 1. Generate a random keypair for testing
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();

    // 2. Fetch challenge transaction
    const challengeRes = await fetch(`${TARGET_URL}/api/auth?account=${publicKey}&network=testnet`);
    if (!challengeRes.ok) {
      throw new Error(`Failed to fetch challenge: ${challengeRes.statusText}`);
    }
    const { transaction } = await challengeRes.json();

    if (!transaction) {
      throw new Error("No transaction returned from challenge endpoint");
    }

    // 3. Sign the challenge
    const tx = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
    tx.sign(keypair);
    const signedXdr = tx.toXDR();

    // 4. Submit signed challenge to get JWT
    const authRes = await fetch(`${TARGET_URL}/api/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transaction: signedXdr,
        network: "testnet"
      })
    });

    if (!authRes.ok) {
      throw new Error(`Failed to authenticate: ${authRes.statusText}`);
    }

    const { token } = await authRes.json();
    if (!token) {
      throw new Error("No token returned from auth endpoint");
    }

    // Print only the token to stdout so it can be captured by the shell script
    console.log(token);
  } catch (error) {
    console.error("Authentication failed:", error.message);
    process.exit(1);
  }
}

authenticate();
