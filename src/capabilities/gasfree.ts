import type {
  GasFreeCapability,
  GasFreeAccountInfo,
  GasFreeTransactionParams,
  GasFreeTransactionList,
  GasFreeSendParams,
  GasFreeTxResult,
} from '@tronlink/tronlink-mcp-core';
import type { Wallet } from '@bankofai/agent-wallet';

export interface GasFreeConfig {
  /**
   * GasFree API base URL
   * 主网: https://open.gasfree.io/tron/
   * Nile: https://open-test.gasfree.io/nile/
   */
  baseUrl: string;
  /** agent-wallet Wallet instance for signing */
  wallet: Wallet;
  /** GasFree API Key（申请: https://developer.gasfree.io） */
  apiKey?: string;
  /** GasFree API Secret */
  apiSecret?: string;
}

export class TronLinkGasFreeCapability implements GasFreeCapability {
  private config: GasFreeConfig;
  private wallet: Wallet;
  private address!: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private generation = 0;

  constructor(config: GasFreeConfig) {
    this.config = config;
    this.wallet = config.wallet;
  }

  /** Resolve wallet address. Guarded against concurrent, stale, and failed calls. */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      const gen = this.generation;
      this.initPromise = (async () => {
        try {
          const addr = await this.wallet.getAddress();
          if (gen !== this.generation) return; // stale — wallet swapped mid-init
          this.address = addr;
          this.initialized = true;
        } catch (err) {
          if (gen === this.generation) this.initPromise = null; // allow retry
          throw err;
        }
      })();
    }
    return this.initPromise;
  }

  /** Replace the wallet and reset cached state so the next operation re-inits. */
  swapWallet(wallet: Wallet): void {
    this.wallet = wallet;
    this.config = { ...this.config, wallet };
    this.initialized = false;
    this.initPromise = null;
    this.generation++;
  }

  private async apiGet(path: string): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['X-API-KEY'] = this.config.apiKey;
    }
    if (this.config.apiSecret) {
      headers['X-API-SECRET'] = this.config.apiSecret;
    }

    const url = `${this.config.baseUrl}${path}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GasFree GET ${path} → ${resp.status}: ${text || resp.statusText}`);
    }
    return resp.json();
  }

  private async apiPost(path: string, body: Record<string, unknown>): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['X-API-KEY'] = this.config.apiKey;
    }
    if (this.config.apiSecret) {
      headers['X-API-SECRET'] = this.config.apiSecret;
    }

    const url = `${this.config.baseUrl}${path}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GasFree POST ${path} → ${resp.status}: ${text || resp.statusText}`);
    }
    return resp.json();
  }

  async getAccount(address?: string): Promise<GasFreeAccountInfo> {
    await this.init();
    const addr = address || this.address;

    // Fetch supported tokens and account info in parallel
    const [tokenData, accountData] = await Promise.all([
      this.apiGet('api/v1/config/token/all'),
      this.apiGet(`api/v1/address/${addr}`),
    ]);

    const supportedTokens = (tokenData.data ?? tokenData ?? []).map((t: any) => ({
      contract_address: t.contract_address ?? t.contractAddress ?? t.tokenAddress ?? '',
      symbol: t.symbol ?? '',
      name: t.name ?? '',
      decimals: t.decimals ?? 0,
      max_amount_per_tx: String(t.max_amount_per_tx ?? t.maxAmountPerTx ?? '0'),
      daily_limit: String(t.daily_limit ?? t.dailyLimit ?? '0'),
      daily_used: String(t.daily_used ?? t.dailyUsed ?? '0'),
    }));

    const isEligible = accountData.data?.status === 'active' ||
      accountData.data?.is_eligible === true ||
      !!accountData.data?.address;

    return {
      address: addr,
      is_eligible: isEligible,
      supported_tokens: supportedTokens,
      daily_quota_remaining: accountData.data?.daily_quota_remaining ??
        accountData.data?.dailyQuotaRemaining ?? 0,
      total_tx_count: accountData.data?.total_tx_count ??
        accountData.data?.totalTxCount ??
        accountData.data?.nonce ?? 0,
    };
  }

  async getTransactions(params: GasFreeTransactionParams): Promise<GasFreeTransactionList> {
    await this.init();
    const addr = params.address || this.address;
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const status = params.status ?? 'all';

    const queryParts: string[] = [
      `limit=${limit}`,
      `offset=${offset}`,
    ];
    if (status !== 'all') {
      queryParts.push(`status=${status}`);
    }

    const qs = queryParts.join('&');
    const data = await this.apiGet(`api/v1/transactions/${addr}?${qs}`);

    return {
      address: addr,
      total: data.data?.total ?? 0,
      transactions: (data.data?.transactions ?? data.data?.list ?? []).map((tx: any) => ({
        tx_id: tx.tx_id ?? tx.txId ?? tx.transactionId ?? tx.hash ?? '',
        from: tx.from ?? tx.fromAddress ?? '',
        to: tx.to ?? tx.toAddress ?? '',
        token_address: tx.token_address ?? tx.tokenAddress ?? '',
        token_symbol: tx.token_symbol ?? tx.tokenSymbol ?? '',
        amount: String(tx.amount ?? '0'),
        status: tx.status ?? 'unknown',
        created_at: tx.created_at ?? tx.createdAt ?? '',
        completed_at: tx.completed_at ?? tx.completedAt ?? undefined,
        error: tx.error ?? undefined,
      })),
    };
  }

  async send(params: GasFreeSendParams): Promise<GasFreeTxResult> {
    await this.init();
    // Submit GasFree transfer via the official API
    // See: https://gasfree.io/specification
    const result = await this.apiPost('api/v1/gasfree/submit', {
      from: this.address,
      to: params.to,
      amount: params.amount,
      contract_address: params.contract_address,
    });

    if (result.code === 0 || result.success) {
      return {
        success: true,
        tx_id: result.data?.tx_id ?? result.data?.txId ??
          result.data?.transactionId ?? result.data?.hash,
        message: result.message ?? `GasFree transfer submitted: ${params.amount} to ${params.to}`,
        status: result.data?.status ?? 'pending',
      };
    }

    return {
      success: false,
      message: result.message ?? result.error ?? 'GasFree transfer failed',
      status: 'failed',
    };
  }
}
