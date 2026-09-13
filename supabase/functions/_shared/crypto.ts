async function aesKey(): Promise<CryptoKey> {
  const secret = (Deno.env.get("TOKEN_ENCRYPTION_SECRET") || "").trim();
  if (!secret) throw new Error("CONFIG_MISSING");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encrypt Meta access token for storage in meta_connections.access_token_encrypted (text). */
export async function encryptAccessToken(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToB64(combined);
}

export async function decryptAccessToken(b64: string): Promise<string> {
  const combined = b64ToBytes(b64);
  if (combined.length < 13) throw new Error("META_TOKEN_INVALID");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const key = await aesKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}
