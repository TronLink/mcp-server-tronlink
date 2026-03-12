import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// Base58 alphabet (no 0, O, I, l)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Derive a TRON address (base58 + hex) from a 64-char hex private key.
 *
 * Steps:
 *  1. Uncompressed public key (65 bytes, 0x04 prefix)
 *  2. Drop the 0x04 prefix → 64 bytes
 *  3. Keccak-256 hash → 32 bytes
 *  4. Take the last 20 bytes
 *  5. Prepend 0x41 (TRON mainnet version byte) → 21 bytes
 *  6. Base58Check-encode for the T-address
 */
export function privateKeyToAddress(privateKeyHex: string): {
  address: string;
  addressHex: string;
} {
  const privKeyBytes = hexToBytes(privateKeyHex);

  // Uncompressed public key: 65 bytes (04 || x || y)
  const uncompressed = secp256k1.getPublicKey(privKeyBytes, false);

  // Remove the 0x04 prefix → 64 bytes (x || y)
  const pubNoPrefix = uncompressed.slice(1);

  // Keccak-256 of the 64 bytes
  const hash = keccak_256(pubNoPrefix);

  // Last 20 bytes of the hash
  const addr20 = hash.slice(hash.length - 20);

  // 21-byte payload: 0x41 + 20-byte address
  const payload = new Uint8Array(21);
  payload[0] = 0x41;
  payload.set(addr20, 1);

  const address = base58CheckEncode(payload);
  const addressHex = bytesToHex(payload);

  return { address, addressHex };
}

/**
 * Sign a TRON transaction given its raw_data_hex.
 *
 * Returns the 65-byte signature as 130 hex chars:
 *   r (32 bytes) + s (32 bytes) + recovery (1 byte)
 */
export function signTransaction(rawDataHex: string, privateKeyHex: string): string {
  const rawDataBytes = hexToBytes(rawDataHex);
  const txHash = sha256(rawDataBytes);

  // noble-curves ecdsa(Pointk1, sha256) prehashes with SHA-256 by default.
  // We already computed SHA-256 ourselves, so disable prehash.
  // format: 'recovered' returns 65 bytes: recovery(1) + r(32) + s(32)
  const sigBytes = secp256k1.sign(txHash, hexToBytes(privateKeyHex), {
    lowS: true,
    prehash: false,
    format: 'recovered',
  });

  // TRON expects: r(32) + s(32) + v(1), where v = recovery + 27
  const recovery = sigBytes[0];
  const result = new Uint8Array(65);
  result.set(sigBytes.slice(1), 0);       // r(32) + s(32)
  result[64] = recovery + 27;              // v = recovery + 27

  return bytesToHex(result);
}

/**
 * Base58Check encode a payload (e.g. 21-byte TRON address).
 *
 *  1. Double SHA-256 of payload → first 4 bytes = checksum
 *  2. Append checksum to payload → (payload.length + 4) bytes
 *  3. Base58-encode the result
 *  4. Leading zero bytes each become '1' in the output
 */
export function base58CheckEncode(payload: Uint8Array): string {
  const first = sha256(payload);
  const second = sha256(first);
  const checksum = second.slice(0, 4);

  const data = new Uint8Array(payload.length + 4);
  data.set(payload);
  data.set(checksum, payload.length);

  return base58Encode(data);
}

/**
 * Base58Check decode (e.g. a T-address → 21 bytes).
 *
 * Reverses base58CheckEncode; validates the 4-byte checksum.
 */
export function base58CheckDecode(address: string): Uint8Array {
  const data = base58Decode(address);
  if (data.length < 5) {
    throw new Error('Base58Check: data too short');
  }

  const payload = data.slice(0, data.length - 4);
  const checksum = data.slice(data.length - 4);

  const first = sha256(payload);
  const second = sha256(first);
  const expected = second.slice(0, 4);

  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Error('Base58Check: invalid checksum');
    }
  }

  return payload;
}

/**
 * Convert a base58 TRON address to its 21-byte hex representation.
 *
 * Example: "TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF" → "41..."
 */
export function addressToHex(base58Address: string): string {
  const payload = base58CheckDecode(base58Address);
  return bytesToHex(payload);
}

/**
 * Convert a 21-byte hex address to its base58 TRON address.
 *
 * Example: "41..." → "TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF"
 */
export function hexToAddress(hexAddress: string): string {
  const payload = hexToBytes(hexAddress);
  return base58CheckEncode(payload);
}

// ── Internal Base58 helpers ────────────────────────────────

function base58Encode(data: Uint8Array): string {
  // Count leading zeros
  let leadingZeros = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      leadingZeros++;
    } else {
      break;
    }
  }

  // Convert byte array to a big integer, then repeatedly divmod by 58
  // We work with a mutable copy as an array of numbers for division.
  const bytes = Array.from(data);
  const result: number[] = [];

  while (bytes.length > 0) {
    let remainder = 0;
    const next: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const value = bytes[i] + remainder * 256;
      const digit = (value / 58) | 0;
      remainder = value % 58;
      if (next.length > 0 || digit > 0) {
        next.push(digit);
      }
    }
    result.unshift(remainder);
    bytes.length = 0;
    bytes.push(...next);
  }

  // Each leading zero byte becomes '1'
  const prefix = BASE58_ALPHABET[0].repeat(leadingZeros);
  return prefix + result.map((d) => BASE58_ALPHABET[d]).join('');
}

function base58Decode(str: string): Uint8Array {
  if (str.length === 0) {
    return new Uint8Array(0);
  }

  // Build a map for O(1) lookups
  const alphabetMap = new Map<string, number>();
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    alphabetMap.set(BASE58_ALPHABET[i], i);
  }

  // Count leading '1's (they represent leading zero bytes)
  let leadingOnes = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '1') {
      leadingOnes++;
    } else {
      break;
    }
  }

  // Convert base58 digits to a byte array via repeated multiply-and-add
  const size = ((str.length * 733) / 1000 + 1) | 0; // log(58)/log(256) ≈ 0.733
  const output = new Uint8Array(size);

  for (let i = 0; i < str.length; i++) {
    const charValue = alphabetMap.get(str[i]);
    if (charValue === undefined) {
      throw new Error(`Base58: invalid character '${str[i]}'`);
    }

    let carry = charValue;
    for (let j = size - 1; j >= 0; j--) {
      carry += 58 * output[j];
      output[j] = carry & 0xff;
      carry >>= 8;
    }
  }

  // Strip leading zeros from conversion, then prepend leading-ones zeros
  let startIndex = 0;
  while (startIndex < output.length && output[startIndex] === 0) {
    startIndex++;
  }

  const result = new Uint8Array(leadingOnes + (output.length - startIndex));
  // leading zeros are already 0
  result.set(output.slice(startIndex), leadingOnes);
  return result;
}
