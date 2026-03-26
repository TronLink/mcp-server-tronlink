import * as crypto from 'node:crypto';
import type {
  MultiSigCapability,
  MultiSigAuthResult,
  MultiSigSubmitParams,
  MultiSigSubmitResult,
  MultiSigListParams,
  MultiSigListResult,
  MultiSigTransactionDetail,
} from '@tronlink/tronlink-mcp-core';
import type { Wallet } from '@bankofai/agent-wallet';
import { signTransaction as signTxWithWallet } from '../wallet.js';

export interface MultiSigConfig {
  /** API base URL (e.g. https://apinile.walletadapter.org) */
  baseURL: string;
  /** Project secret ID */
  secretId: string;
  /** Project secret key (for HmacSHA256 signature) */
  secretKey: string;
  /** Channel / project name */
  channel: string;

  // ── TronGrid (on-chain operations) ──────────────
  /** TronGrid full node URL (e.g. https://nile.trongrid.io) */
  tronGridUrl?: string;
  /** TronGrid API key (optional for testnet, required for mainnet) */
  tronGridApiKey?: string;

  // ── Wallet instances for signing ────────────────
  /** Owner wallet for signing (e.g. permission updates) */
  ownerWallet?: Wallet;
  /** Co-signer wallet for multisig signing */
  cosignerWallet?: Wallet;
}

/** Result of setting up multisig permissions on-chain */
export interface SetupPermissionsResult {
  success: boolean;
  txId?: string;
  error?: string;
}

/** Result of creating an unsigned transaction */
export interface CreateTransactionResult {
  success: boolean;
  transaction?: Record<string, unknown>;
  error?: string;
}

/** Result of broadcasting a signed transaction */
export interface BroadcastResult {
  success: boolean;
  txId?: string;
  error?: string;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function sortAndJoinParams(params: Record<string, string | number>): string {
  const keys = Object.keys(params).sort();
  return keys.map((key) => `${key}=${params[key]}`).join('&');
}

function generateSign(message: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(message);
  return hmac.digest('base64');
}

function generateAuthParams(
  method: string,
  path: string,
  address: string,
  channel: string,
  secretId: string,
  secretKey: string,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    address,
    channel,
    secret_id: secretId,
    sign_version: 'v1',
    ts: Date.now(),
    uuid: generateUUID(),
  };

  const queryString = sortAndJoinParams(params);
  const signString = `${method}${path}?${queryString}`;
  const sign = generateSign(signString, secretKey);

  return { ...params, sign };
}

/**
 * TronLink Multi-Signature capability implementation.
 * Wraps the TRON multi-signature service API (REST + WebSocket)
 * and provides on-chain helpers for multisig setup via TronGrid.
 */
export class TronLinkMultiSigCapability implements MultiSigCapability {
  private config: MultiSigConfig;
  private ws: WebSocket | undefined;
  private wsConnected = false;

  constructor(config: MultiSigConfig) {
    this.config = config;
  }

  /** Get TronGrid config (for tool handlers to check availability) */
  getTronGridUrl(): string | undefined {
    return this.config.tronGridUrl;
  }

  getOwnerWallet(): Wallet | undefined {
    return this.config.ownerWallet;
  }

  getCosignerWallet(): Wallet | undefined {
    return this.config.cosignerWallet;
  }

  /** Replace wallet references for hot-swap. */
  swapWallets(ownerWallet?: Wallet, cosignerWallet?: Wallet): void {
    this.config = {
      ...this.config,
      ownerWallet: ownerWallet ?? this.config.ownerWallet,
      cosignerWallet: cosignerWallet ?? this.config.cosignerWallet,
    };
  }

  // ── Multisig Service API (walletadapter.org) ────────────

  async queryAuth(address: string): Promise<MultiSigAuthResult> {
    const path = '/multi/auth';
    const authParams = generateAuthParams(
      'GET', path, address,
      this.config.channel, this.config.secretId, this.config.secretKey,
    );

    const qs = Object.entries({ address, ...authParams })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    const resp = await fetch(`${this.config.baseURL}${path}?${qs}`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return (await resp.json()) as MultiSigAuthResult;
  }

  async submitTransaction(params: MultiSigSubmitParams): Promise<MultiSigSubmitResult> {
    const path = '/multi/transaction';
    const authParams = generateAuthParams(
      'POST', path, params.address,
      this.config.channel, this.config.secretId, this.config.secretKey,
    );

    const qs = Object.entries(authParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    // Default expire_time to 24 hours from now if not specified
    const body = {
      ...params,
      expire_time: params.expire_time ?? (Date.now() + 24 * 60 * 60 * 1000),
    };

    const resp = await fetch(`${this.config.baseURL}${path}?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return (await resp.json()) as MultiSigSubmitResult;
  }

  async queryTransactionList(params: MultiSigListParams): Promise<MultiSigListResult> {
    const path = '/multi/list';
    const authParams = generateAuthParams(
      'GET', path, params.address,
      this.config.channel, this.config.secretId, this.config.secretKey,
    );

    const allParams: Record<string, string | number | boolean> = {
      address: params.address,
      start: params.start,
      limit: params.limit,
      state: params.state,
      ...authParams,
    };
    if (params.is_sign !== undefined) {
      allParams.is_sign = params.is_sign;
    }

    const qs = Object.entries(allParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');

    const resp = await fetch(`${this.config.baseURL}${path}?${qs}`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return (await resp.json()) as MultiSigListResult;
  }

  async connectWebSocket(
    address: string,
    onTransaction: (tx: MultiSigTransactionDetail | MultiSigTransactionDetail[]) => void,
  ): Promise<void> {
    // Dynamic import of ws for Node.js
    const { default: WebSocket } = await import('ws');

    return new Promise((resolve, reject) => {
      const wsUrl = this.config.baseURL.replace(/^http/, 'ws') + '/multi/socket';
      const authParams = generateAuthParams(
        'GET', '/multi/socket', address,
        this.config.channel, this.config.secretId, this.config.secretKey,
      );

      const qs = Object.entries(authParams)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');

      const fullUrl = `${wsUrl}?${qs}`;
      const ws = new WebSocket(fullUrl);

      ws.on('open', () => {
        ws.send(JSON.stringify({ address, version: 'v1' }));
        this.wsConnected = true;
        resolve();
      });

      ws.on('message', (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
            onTransaction(parsed as MultiSigTransactionDetail | MultiSigTransactionDetail[]);
          }
        } catch {
          // ignore non-JSON messages
        }
      });

      ws.on('error', (err: Error) => {
        this.wsConnected = false;
        reject(err);
      });

      ws.on('close', () => {
        this.wsConnected = false;
      });

      // Store for later disconnect (cast to any to store ws instance)
      this.ws = ws as unknown as WebSocket;
    });
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      (this.ws as any).close();
      this.ws = undefined;
      this.wsConnected = false;
    }
  }

  isWebSocketConnected(): boolean {
    return this.wsConnected;
  }

  // ── TronGrid on-chain helpers ───────────────────────────

  /**
   * Make a TronGrid API call.
   * @throws if TronGrid URL is not configured.
   */
  private async tronGridPost(
    apiPath: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.config.tronGridUrl) {
      throw new Error(
        'TronGrid URL not configured. Set TL_TRONGRID_URL (e.g. https://nile.trongrid.io)',
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.tronGridApiKey) {
      headers['TRON-PRO-API-KEY'] = this.config.tronGridApiKey;
    }

    const resp = await fetch(`${this.config.tronGridUrl}${apiPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`TronGrid HTTP ${resp.status}: ${resp.statusText}`);
    }

    return (await resp.json()) as Record<string, unknown>;
  }

  /**
   * Set up multisig permissions on an account via accountPermissionUpdate.
   * Requires ownerKey to sign the permission update transaction.
   *
   * @param ownerAddress - The account to update permissions on
   * @param cosignerAddress - The co-signer address to add
   * @param threshold - Required signature weight (default: 2)
   */
  async setupPermissions(
    ownerAddress: string,
    cosignerAddress: string,
    threshold = 2,
  ): Promise<SetupPermissionsResult> {
    if (!this.config.ownerWallet) {
      return { success: false, error: 'Owner wallet not configured' };
    }

    try {
      // Step 1: Create accountPermissionUpdate transaction
      const unsignedTx = await this.tronGridPost(
        '/wallet/accountpermissionupdate',
        {
          owner_address: ownerAddress,
          owner: {
            type: 0,
            permission_name: 'owner',
            threshold: 1,
            keys: [{ address: ownerAddress, weight: 1 }],
          },
          actives: [
            {
              type: 2,
              permission_name: 'active0',
              threshold,
              operations:
                '7fff1fc0033e0000000000000000000000000000000000000000000000000000',
              keys: [
                { address: ownerAddress, weight: 1 },
                { address: cosignerAddress, weight: 1 },
              ],
            },
          ],
          visible: true,
        },
      );

      if (unsignedTx.Error) {
        return { success: false, error: String(unsignedTx.Error) };
      }

      // Step 2: Sign with owner wallet
      const signedTx = await signTxWithWallet(
        this.config.ownerWallet,
        unsignedTx as Record<string, unknown>,
      );

      // Step 3: Broadcast
      const result = await this.broadcastTransaction(signedTx);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an unsigned TRX transfer transaction that requires multisig.
   * Uses Permission_id=2 (active permission).
   */
  async createMultisigTransfer(
    fromAddress: string,
    toAddress: string,
    amountSun: number,
    permissionId = 2,
  ): Promise<CreateTransactionResult> {
    try {
      const tx = await this.tronGridPost('/wallet/createtransaction', {
        owner_address: fromAddress,
        to_address: toAddress,
        amount: amountSun,
        Permission_id: permissionId,
        visible: true,
      });

      if (tx.Error) {
        return { success: false, error: String(tx.Error) };
      }

      return { success: true, transaction: tx };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sign a transaction with a wallet instance.
   */
  async signWithWallet(
    transaction: Record<string, unknown>,
    wallet: Wallet,
  ): Promise<Record<string, unknown>> {
    // Sign a clean copy to get the new signature
    const cleanTx = { ...transaction, signature: undefined };
    const signedTx = await signTxWithWallet(wallet, cleanTx);
    const newSignature = (signedTx.signature as string[])[0];

    // Append to existing signatures
    const existingSignatures = (transaction.signature as string[]) || [];
    return {
      ...transaction,
      signature: [...existingSignatures, newSignature],
    };
  }

  /**
   * Broadcast a signed transaction to the TRON network via TronGrid.
   */
  async broadcastTransaction(
    signedTx: Record<string, unknown>,
  ): Promise<BroadcastResult> {
    try {
      const result = await this.tronGridPost(
        '/wallet/broadcasttransaction',
        signedTx,
      );

      if (result.result === true) {
        return {
          success: true,
          txId: (result.txid as string) || (signedTx.txID as string),
        };
      }
      return {
        success: false,
        error: String(
          result.message || result.Error || 'Broadcast failed',
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get account info from TronGrid (balance, permissions, etc.)
   */
  async getAccountInfo(
    address: string,
  ): Promise<Record<string, unknown>> {
    return this.tronGridPost('/wallet/getaccount', {
      address,
      visible: true,
    });
  }
}
