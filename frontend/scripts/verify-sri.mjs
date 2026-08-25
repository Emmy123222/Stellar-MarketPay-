import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HASHES_PATH = resolve(__dirname, "sri-hashes.json");

async function fetchAsset(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

function computeSRI(content, algorithm = "sha256") {
  const hash = createHash(algorithm).update(content).digest("base64");
  return `${algorithm}-${hash}`;
}

async function main() {
  const updateMode = process.argv.includes("--update");
  const hashes = JSON.parse(readFileSync(HASHES_PATH, "utf-8"));
  let failures = 0;

  for (const asset of hashes.externalAssets) {
    try {
      const content = await fetchAsset(asset.url);
      const currentHash = computeSRI(content, asset.algorithm);

      if (currentHash !== asset.hash) {
        console.error(`[SRI MISMATCH] ${asset.url}`);
        console.error(`  expected: ${asset.hash}`);
        console.error(`  actual:   ${currentHash}`);

        if (updateMode) {
          asset.hash = currentHash;
          console.log(`  -> updated to ${currentHash}`);
        } else {
          failures++;
        }
      } else {
        console.log(`[OK] ${asset.url}`);
      }
    } catch (err) {
      console.error(`[ERROR] ${asset.url}: ${err.message}`);
      failures++;
    }
  }

  if (updateMode && failures === 0) {
    writeFileSync(HASHES_PATH, JSON.stringify(hashes, null, 2) + "\n");
    console.log("\nSRI hashes updated.");
  }

  if (failures > 0) {
    console.error(`\n${failures} hash verification(s) failed.`);
    console.error("Run with --update to refresh hashes after a legitimate dependency update.");
    process.exit(1);
  }

  console.log("\nAll SRI hashes verified.");
}

main();
