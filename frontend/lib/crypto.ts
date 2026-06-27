/**
 * lib/crypto.ts
 * NaCl box (X25519-XSalsa20-Poly1305) key management for E2E file encryption.
 *
 * Keys are persisted in localStorage as base64. v1 limitation: XSS can
 * exfiltrate the private key. Keys are per-device; a message encrypted on one
 * device cannot be decrypted on another. A future version should use
 * SubtleCrypto.generateKey with extractable:false.
 */
import nacl from "tweetnacl";

const STORAGE_KEY = "smp_nacl_keypair";

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function toBase64(u: Uint8Array): string {
  return btoa(String.fromCharCode(...u));
}

export function getOrCreateKeypair(): nacl.BoxKeyPair {
  if (typeof window === "undefined") throw new Error("Browser only");
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const { pub, sec } = JSON.parse(stored);
      return { publicKey: fromBase64(pub), secretKey: fromBase64(sec) };
    } catch {
      // corrupt — regenerate
    }
  }
  const kp = nacl.box.keyPair();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ pub: toBase64(kp.publicKey), sec: toBase64(kp.secretKey) }),
  );
  return kp;
}

export function myPublicKeyBase64(): string {
  return toBase64(getOrCreateKeypair().publicKey);
}

export function encryptForRecipient(
  data: Uint8Array,
  recipientPublicKeyBase64: string,
): Uint8Array {
  const { secretKey } = getOrCreateKeypair();
  const recipientPublicKey = fromBase64(recipientPublicKeyBase64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(data, nonce, recipientPublicKey, secretKey);
  if (!ciphertext) throw new Error("Encryption failed");
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  return result;
}

export function decryptFromSender(
  combined: Uint8Array,
  senderPublicKeyBase64: string,
): Uint8Array {
  const { secretKey } = getOrCreateKeypair();
  const senderPublicKey = fromBase64(senderPublicKeyBase64);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const plaintext = nacl.box.open(ciphertext, nonce, senderPublicKey, secretKey);
  if (!plaintext) throw new Error("Decryption failed — wrong key or corrupted data");
  return plaintext;
}
