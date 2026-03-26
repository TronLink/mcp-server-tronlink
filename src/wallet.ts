/**
 * Unified wallet entry point.
 *
 * Wraps @bankofai/agent-wallet with a strict policy:
 *   - ONLY encrypted local wallets (local_secure) are allowed.
 *   - Environment-variable fallback (AGENT_WALLET_PRIVATE_KEY / MNEMONIC) is blocked.
 *   - Private keys never appear in config, logs, or MCP call chains.
 *
 * All modules that need signing MUST go through this file.
 */

import {
  ConfigWalletProvider,
  SecureKVStore,
  resolveWalletProvider,
  type Wallet,
  type WalletConfig,
} from '@bankofai/agent-wallet';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Secret loader for local_secure wallets ───────────────

/**
 * Mirrors the internal `loadLocalSecret` that `resolveWalletProvider` uses,
 * but is not exported from the package — so we replicate it here.
 */
function loadLocalSecret(configDir: string, password: string, secretRef: string): Uint8Array {
  const store = new SecureKVStore(configDir, password);
  store.verifyPassword();
  return store.loadSecret(secretRef);
}

// ── Cached instances ────────────────────────────────────

let _walletCache = new Map<string, Promise<Wallet>>();
let _addressCache = new Map<string, Promise<string>>();

/** Clear cached wallet/address (e.g. after switching active wallet). */
export function clearWalletCache(): void {
  _walletCache.clear();
  _addressCache.clear();
}

// ── Config ──────────────────────────────────────────────

function getConfigDir(): string {
  return process.env.AGENT_WALLET_DIR || join(homedir(), '.agent-wallet');
}

function getEnvPassword(): string | undefined {
  return process.env.AGENT_WALLET_PASSWORD || undefined;
}

/** Cached resolved password. */
let _resolvedPassword: string | undefined;

/**
 * Read-only password resolution — no side effects.
 *
 * Priority:
 *   1. AGENT_WALLET_PASSWORD env var
 *   2. Existing runtime_secrets.json in config dir
 *   3. Throw — no password available
 *
 * Used by resolveSecureWallet / listWallets / setActiveWallet.
 */
function resolvePassword(): string {
  if (_resolvedPassword) return _resolvedPassword;

  // 1. Env var
  const envPw = getEnvPassword();
  if (envPw) {
    _resolvedPassword = envPw;
    return envPw;
  }

  // 2. Existing runtime_secrets.json
  const configDir = getConfigDir();
  const secretsPath = join(configDir, 'runtime_secrets.json');
  if (existsSync(secretsPath)) {
    try {
      const data = JSON.parse(readFileSync(secretsPath, 'utf-8')) as { password?: string };
      if (data.password) {
        _resolvedPassword = data.password;
        return data.password;
      }
    } catch {
      // Corrupted file — fall through
    }
  }

  // 3. No password — caller decides what to do
  throw new Error(
    'No wallet password available.\n' +
    'Set AGENT_WALLET_PASSWORD in your MCP config env, or let the server auto-generate on restart.',
  );
}

/**
 * Resolve or generate a password for auto-wallet-creation.
 *
 * Same as resolvePassword() but falls back to generating a new random
 * password when none exists AND no existing wallets would be orphaned.
 * This is the ONLY place that writes runtime_secrets.json.
 */
function resolveOrGeneratePassword(): string {
  // Try read-only first
  try {
    return resolvePassword();
  } catch {
    // No password available — check if safe to generate
  }

  const configDir = getConfigDir();
  const walletConfigPath = join(configDir, 'wallets_config.json');
  const masterPath = join(configDir, 'master.json');
  if (existsSync(walletConfigPath) || existsSync(masterPath)) {
    throw new Error(
      'Existing wallets found but no password available.\n' +
      'runtime_secrets.json is missing or corrupted.\n' +
      'Set AGENT_WALLET_PASSWORD in your MCP config env to unlock existing wallets.',
    );
  }

  // No existing wallets — safe to generate a fresh password
  const generated = randomBytes(32).toString('hex');
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const secretsPath = join(configDir, 'runtime_secrets.json');
  writeFileSync(secretsPath, JSON.stringify({ password: generated }), { mode: 0o600 });
  _resolvedPassword = generated;
  return generated;
}

// ── Core: resolve wallet (encrypted only) ───────────────

/**
 * Resolve an encrypted wallet by ID.
 *
 * Unlike raw `resolveWallet()`, this function:
 *   1. Only accepts ConfigWalletProvider (local encrypted storage).
 *   2. Rejects EnvWalletProvider (plain-text env vars).
 *   3. Throws a clear error if no encrypted wallet is configured.
 */
export async function resolveSecureWallet(
  network: string,
  walletId?: string,
): Promise<Wallet> {
  const cacheKey = `${network}:${walletId ?? '__active__'}`;
  let cached = _walletCache.get(cacheKey);
  if (cached) return cached;

  const promise = _resolveSecureWalletImpl(network, walletId);
  _walletCache.set(cacheKey, promise);

  // If the promise rejects, remove from cache so next call retries
  promise.catch(() => _walletCache.delete(cacheKey));

  return promise;
}

async function _resolveSecureWalletImpl(
  network: string,
  walletId?: string,
): Promise<Wallet> {
  const configDir = getConfigDir();
  const password = resolvePassword();

  // Try ConfigWalletProvider first (encrypted storage)
  let provider: ConfigWalletProvider;
  try {
    const resolved = resolveWalletProvider({ network, dir: configDir });
    if (!(resolved instanceof ConfigWalletProvider)) {
      throw new Error(
        'Environment-variable wallets are not allowed. ' +
        'Use encrypted storage: agent-wallet start local_secure --generate --wallet-id <id>',
      );
    }
    provider = resolved;
  } catch (err) {
    // resolveWalletProvider may throw if nothing is configured at all
    if (err instanceof Error && err.message.includes('not allowed')) {
      throw err;
    }

    // Create a provider directly with resolved password
    provider = new ConfigWalletProvider(configDir, password, { network, secretLoader: loadLocalSecret });
  }

  // Check that wallets actually exist
  const wallets = provider.listWallets();
  if (wallets.length === 0) {
    throw new Error(
      'No wallets in encrypted storage. Create one:\n' +
      '  agent-wallet start local_secure --generate --wallet-id main',
    );
  }

  // Determine which wallet to use
  const activeId = provider.getActiveId();
  const targetId = walletId ?? activeId;
  if (!targetId) {
    if (wallets.length === 1) {
      // Single wallet — safe to use without ambiguity
    } else {
      throw new Error(
        `Multiple wallets found but no wallet ID specified and no active wallet set.\n` +
        `Available wallets: ${wallets.map(([id]) => id).join(', ')}\n` +
        'Either pass a wallet ID or set one as active: agent-wallet use <wallet-id>',
      );
    }
  }

  // Verify the target wallet is local_secure (encrypted), not raw_secret (plaintext)
  const resolvedId = targetId ?? wallets[0][0];
  const targetWallet = wallets.find(([id]) => id === resolvedId);
  if (targetWallet) {
    const [, config] = targetWallet;
    if (config.type !== 'local_secure') {
      throw new Error(
        `Wallet "${resolvedId}" is type "${config.type}" (plaintext). ` +
        'Only encrypted wallets (local_secure) are allowed.\n' +
        'Create one: agent-wallet start local_secure --generate --wallet-id <id>',
      );
    }
  }

  return provider.getWallet(resolvedId, network);
}

// ── Convenience helpers ─────────────────────────────────

/**
 * Get the wallet address (cached).
 */
export async function getWalletAddress(
  network: string,
  walletId?: string,
): Promise<string> {
  const cacheKey = `${network}:${walletId ?? '__active__'}`;
  let cached = _addressCache.get(cacheKey);
  if (cached) return cached;

  const promise = resolveSecureWallet(network, walletId).then(w => w.getAddress());
  _addressCache.set(cacheKey, promise);
  promise.catch(() => _addressCache.delete(cacheKey));

  return promise;
}

// ── Provider helper ──────────────────────────────────────

/** Get a ConfigWalletProvider (creates storage if needed). */
export function getProvider(network?: string): ConfigWalletProvider {
  const configDir = getConfigDir();
  const password = resolvePassword();
  const provider = new ConfigWalletProvider(configDir, password, { network, secretLoader: loadLocalSecret });
  provider.ensureStorage();
  return provider;
}

// ── Wallet management ────────────────────────────────────

export interface WalletInfo {
  id: string;
  type: string;
  active: boolean;
  address?: string;
}

/** List all wallets with optional address resolution. */
export async function listWallets(network: string): Promise<WalletInfo[]> {
  const provider = getProvider(network);
  const wallets = provider.listWallets();
  const results: WalletInfo[] = [];

  for (const [id, config, isActive] of wallets) {
    let address: string | undefined;
    try {
      const w = await provider.getWallet(id, network);
      address = await w.getAddress();
    } catch {
      // Could not decrypt — skip address
    }
    results.push({ id, type: config.type, active: isActive, address });
  }
  return results;
}

/** Set the active wallet by ID. Returns the wallet address. */
export async function setActiveWallet(
  network: string,
  walletId: string,
): Promise<string> {
  const provider = getProvider(network);

  // Verify the wallet can be decrypted BEFORE changing active state
  const wallet = await provider.getWallet(walletId, network);
  const address = await wallet.getAddress();

  provider.setActive(walletId);
  clearWalletCache();

  return address;
}

/**
 * Auto-generate an encrypted wallet if none exists.
 *
 * Returns the wallet address, or undefined if wallets already exist.
 */
export async function autoGenerateWallet(
  network: string,
  logger?: (msg: string) => void,
): Promise<string | undefined> {
  const configDir = getConfigDir();

  // resolveOrGeneratePassword() will throw if wallets exist but password
  // is lost — that's the correct behavior (don't silently overwrite).
  let password: string;
  try {
    password = resolveOrGeneratePassword();
  } catch (err) {
    logger?.(`Password resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  // Check if wallets already exist
  try {
    const provider = new ConfigWalletProvider(configDir, password, { network, secretLoader: loadLocalSecret });
    const wallets = provider.listWallets();
    if (wallets.length > 0) return undefined;
  } catch {
    // Config dir may not exist yet — will be created below
  }

  const walletId = 'main';
  logger?.('No wallets found. Auto-generating encrypted wallet...');

  try {
    // 1. Create directory
    mkdirSync(configDir, { recursive: true, mode: 0o700 });

    // 2. Initialize master.json (encryption key derived from password)
    const store = new SecureKVStore(configDir, password);
    store.initMaster();

    // 3. Generate encrypted private key
    store.generateSecret(walletId, { length: 32 });

    // 4. Create provider and register wallet
    const provider = new ConfigWalletProvider(configDir, password, { network, secretLoader: loadLocalSecret });
    provider.ensureStorage();
    const walletConfig: WalletConfig = {
      type: 'local_secure',
      params: { secret_ref: walletId },
    };
    provider.addWallet(walletId, walletConfig, { setActiveIfMissing: true });

    // 5. Verify it works
    const wallet = await provider.getWallet(walletId, network);
    const address = await wallet.getAddress();

    clearWalletCache();
    logger?.(`Auto-generated encrypted wallet "${walletId}": ${address}`);
    logger?.(`Encrypted private key stored in ${configDir}`);
    logger?.('Fund this address with TRX before performing write operations.');
    return address;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger?.(`Auto-generate failed: ${detail}`);
    return undefined;
  }
}

/**
 * Sign an unsigned transaction via the wallet and return the signed tx object.
 *
 * Handles the various return formats from agent-wallet's signTransaction:
 *   - JSON string of the full signed tx → parse
 *   - Hex signature string → wrap into { ...tx, signature: [hex] }
 */
export async function signTransaction(
  wallet: Wallet,
  unsignedTx: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await wallet.signTransaction(unsignedTx);

  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as Record<string, unknown>;
      if (Array.isArray(parsed.signature) && parsed.signature.length > 0) {
        // Merge parsed fields onto unsignedTx to preserve raw_data/txID
        return { ...unsignedTx, ...parsed };
      }
      // Parsed but no valid signature array — treat as signature hex
      return { ...unsignedTx, signature: [result] };
    } catch {
      // Not JSON — raw hex signature
      return { ...unsignedTx, signature: [result] };
    }
  }

  // Should not happen per the Wallet interface, but handle gracefully
  return { ...unsignedTx, signature: [String(result)] };
}
