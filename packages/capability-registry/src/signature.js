import crypto from "node:crypto";

// Plugin signature verification.
//
// A plugin manifest carries a `signature` field. The signed content is the
// canonical JSON of the manifest with `signature` removed; the loader passes us
// the sha256 digest of that canonical form plus the raw signature. We verify the
// signature against a set of trusted Ed25519 public keys.
//
// Trusted keys come from SYSCORA_PLUGIN_TRUSTED_KEYS: a comma-separated list of
// PEM public keys (newlines encoded as \n) or base64-encoded DER SPKI keys. When
// no trusted keys are configured, verification fails closed — an operator must
// explicitly establish trust before any plugin can load.

function parsePublicKey(raw) {
  const value = raw.trim();
  if (value === "") return null;
  try {
    if (value.includes("BEGIN PUBLIC KEY") || value.includes("\\n")) {
      const pem = value.replace(/\\n/g, "\n");
      return crypto.createPublicKey(pem);
    }
    // Otherwise treat as base64 DER (SPKI).
    return crypto.createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

export function loadTrustedKeys(env = process.env) {
  const raw = env.SYSCORA_PLUGIN_TRUSTED_KEYS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => parsePublicKey(entry))
    .filter(Boolean);
}

// Build a verifier compatible with CapabilityPluginLoader's verifySignature hook.
// Returns async ({ manifest, digest, signature }) => boolean.
export function createPluginSignatureVerifier({ trustedKeys = loadTrustedKeys() } = {}) {
  return async function verifySignature({ digest, signature }) {
    if (!signature || trustedKeys.length === 0) return false;
    let signatureBytes;
    try {
      signatureBytes = Buffer.from(signature, "base64");
    } catch {
      return false;
    }
    if (signatureBytes.length === 0) return false;
    const message = Buffer.from(String(digest), "utf8");
    for (const key of trustedKeys) {
      try {
        // Ed25519 verification uses a null algorithm (the key identifies it).
        if (crypto.verify(null, message, key, signatureBytes)) return true;
      } catch {
        // Try the next trusted key.
      }
    }
    return false;
  };
}
