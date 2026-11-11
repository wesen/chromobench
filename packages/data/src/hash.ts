// SHA-256 over bytes, synchronous and identical in node and the browser (@noble/hashes, as the contract uses).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const sha256Hex = (b: Uint8Array): string => bytesToHex(sha256(b));
