import { addressToHex, base58CheckDecode } from './tron-crypto.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Wallet } from '@bankofai/agent-wallet';
import { signTransaction as signTxWithWallet } from '../wallet.js';
import type {
  OnChainCapability,
  ChainAccountInfo,
  ChainStakingInfo,
  ChainSwapV3Params,
  ChainSwapV3Result,
  ChainTokensInfo,
  ChainSendParams,
  ChainTxResult,
  ChainTransactionInfo,
  ChainHistoryParams,
  ChainTransactionList,
  ChainStakeParams,
  ChainResourceParams,
  ChainResourceResult,
  ChainSwapParams,
  ChainSwapResult,
  ChainSetupMultisigParams,
  ChainCreateMultisigTxParams,
  ChainUnsignedTxResult,
  ChainSignMultisigTxParams,
  ChainSignedTxResult,
} from '@tronlink/tronlink-mcp-core';

// ── Configuration ──────────────────────────────────────────

export interface OnChainConfig {
  /** agent-wallet Wallet instance for signing */
  wallet: Wallet;
  /** TronGrid full-node URL, e.g. https://nile.trongrid.io */
  tronGridUrl: string;
  /** Optional TronGrid API key (required on mainnet) */
  tronGridApiKey?: string;
  /** Optional co-signer wallet instance */
  cosignerWallet?: Wallet;
  /** Optional SunSwap V2 router address (base58) — auto-detected if omitted */
  sunswapRouter?: string;
  /** Optional SunSwap V3 router address (base58) — auto-detected if omitted */
  sunswapV3Router?: string;
  /** WTRX address — auto-detected from network if omitted */
  wtrxAddress?: string;
}

// ── Network-aware SunSwap constants (from sun-mcp-server) ──

interface SwapNetworkConstants {
  wtrx: string;
  v2Router: string;
  v3Router: string;
  routerApiUrl: string;
  trxAddress: string;
}

const SWAP_MAINNET: SwapNetworkConstants = {
  wtrx: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR',
  v2Router: 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax',
  v3Router: 'TQAvWQpT9H916GckwWDJNhYZvQMkuRL7PN',
  routerApiUrl: 'https://rot.endjgfsv.link',
  trxAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
};

const SWAP_NILE: SwapNetworkConstants = {
  wtrx: 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a',
  v2Router: 'TMn1qrmYUMSTXo9babrJLzepKZoPC7M6Sy',
  v3Router: 'TQAvWQpT9H916GckwWDJNhYZvQMkuRL7PN',
  routerApiUrl: 'https://tnrouter.endjgfsv.link',
  trxAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
};

function detectNetwork(tronGridUrl: string): 'mainnet' | 'nile' {
  const lower = tronGridUrl.toLowerCase();
  if (lower.includes('nile')) return 'nile';
  return 'mainnet';
}

function getSwapConstants(tronGridUrl: string): SwapNetworkConstants {
  return detectNetwork(tronGridUrl) === 'nile' ? SWAP_NILE : SWAP_MAINNET;
}

// ── SunSwap Router API (from sun-mcp-server) ───────────────

interface RouterAPIRoute {
  amountIn: string;
  amountInRaw: string;
  amountOut: string;
  amountOutRaw: string;
  tokens: string[];
  symbols: string[];
  poolVersions: string[];
  impact: string;
}

interface RouterAPIResponse {
  code: number;
  message: string;
  data: RouterAPIRoute[];
}

async function fetchRouterAPI(
  baseUrl: string,
  fromToken: string,
  toToken: string,
  amountIn: string,
): Promise<RouterAPIResponse> {
  const url = new URL('/swap/routerUniversal', baseUrl);
  url.searchParams.append('fromToken', fromToken);
  url.searchParams.append('toToken', toToken);
  url.searchParams.append('amountIn', amountIn);
  url.searchParams.append('typeList', '');
  url.searchParams.append('maxCost', '3');
  url.searchParams.append('includeUnverifiedV4Hook', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Router API HTTP error: ${response.status}`);
  }

  const data = (await response.json()) as RouterAPIResponse;
  if (data.code !== 0) {
    throw new Error(`Router API error: ${data.message}`);
  }
  return data;
}

// ── Helpers ────────────────────────────────────────────────

const SUN_PER_TRX = 1_000_000;

/** Decode an ABI-encoded string return value (offset + length + data). */
function decodeAbiString(hex: string): string {
  if (!hex || hex.length < 128) return '';
  try {
    // ABI string encoding: [offset 32B][length 32B][utf8 data...]
    const lengthHex = hex.slice(64, 128);
    const strLen = Number(BigInt('0x' + lengthHex));
    if (strLen === 0 || strLen > 1000) return '';
    const dataHex = hex.slice(128, 128 + strLen * 2);
    const bytes = new Uint8Array(dataHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/** Convert a TRX string / number to SUN (integer). */
function toSun(trx: string | number): number {
  return Math.round(Number(trx) * SUN_PER_TRX);
}

/** Left-pad a hex string to the given byte-width (default 32 bytes = 64 hex chars). */
function padHex(hex: string, bytes = 32): string {
  const target = bytes * 2;
  if (hex.length > target) {
    throw new Error(`padHex: value too large (${hex.length} > ${target})`);
  }
  return hex.padStart(target, '0');
}

/** Encode a uint256 value as 32-byte hex (no 0x prefix). */
function uint256Hex(value: bigint | number | string): string {
  let n: bigint;
  if (typeof value === 'bigint') {
    n = value;
  } else {
    n = BigInt(value);
  }
  return padHex(n.toString(16));
}

/**
 * Get the 20-byte (hex) address without TRON's 0x41 prefix.
 * Accepts either base58 or hex (with or without 41 prefix).
 */
function to20ByteHex(address: string): string {
  if (address.startsWith('T')) {
    // base58 → decode → strip 0x41 prefix
    const payload = base58CheckDecode(address);
    return bytesToHex(payload.slice(1));
  }
  // Hex address: strip leading '41' if present
  const lower = address.toLowerCase();
  if (lower.startsWith('41') && lower.length === 42) {
    return lower.slice(2);
  }
  return lower;
}

// ── On-chain capability class ──────────────────────────────

export class TronLinkOnChainCapability implements OnChainCapability {
  private config: OnChainConfig;
  private wallet: Wallet;
  private address!: string;
  private addressHex!: string;
  private swapConstants: SwapNetworkConstants;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private generation = 0;

  constructor(config: OnChainConfig) {
    this.config = config;
    this.wallet = config.wallet;
    this.swapConstants = getSwapConstants(config.tronGridUrl);
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
          this.addressHex = addressToHex(addr);
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
  swapWallet(wallet: Wallet, cosignerWallet?: Wallet): void {
    this.wallet = wallet;
    this.config = { ...this.config, wallet, cosignerWallet: cosignerWallet ?? this.config.cosignerWallet };
    this.initialized = false;
    this.initPromise = null;
    this.generation++;
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('OnChainCapability not initialized. Call init() first.');
    }
  }

  // ── Internal: HTTP helpers ──────────────────────────────

  private async tronGridPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.tronGridApiKey) {
      headers['TRON-PRO-API-KEY'] = this.config.tronGridApiKey;
    }

    const url = `${this.config.tronGridUrl}${path}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`TronGrid POST ${path} → ${resp.status}: ${text || resp.statusText}`);
    }

    return resp.json();
  }

  private async tronGridGet(path: string): Promise<any> {
    const headers: Record<string, string> = {};
    if (this.config.tronGridApiKey) {
      headers['TRON-PRO-API-KEY'] = this.config.tronGridApiKey;
    }

    const url = `${this.config.tronGridUrl}${path}`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`TronGrid GET ${path} → ${resp.status}: ${text || resp.statusText}`);
    }

    return resp.json();
  }

  /**
   * Sign a transaction and broadcast it.
   * Returns { success, txId }.
   */
  private async signAndBroadcast(
    unsignedTx: Record<string, unknown>,
  ): Promise<{ success: boolean; txId: string }> {
    const signedTx = await signTxWithWallet(this.wallet, unsignedTx);

    const result = await this.tronGridPost('/wallet/broadcasttransaction', signedTx);

    if (result.result === true) {
      return {
        success: true,
        txId: (result.txid as string) || (unsignedTx.txID as string) || '',
      };
    }

    // Decode hex error messages from TronGrid
    let errorMsg = result.message || result.Error || 'Broadcast failed';
    if (typeof errorMsg === 'string' && /^[0-9a-fA-F]+$/.test(errorMsg)) {
      try {
        errorMsg = Buffer.from(errorMsg, 'hex').toString('utf8');
      } catch {
        // keep original
      }
    }
    throw new Error(String(errorMsg));
  }

  /** Return the given address or fall back to the wallet's own address. */
  private resolveAddress(address?: string): string {
    return address || this.address;
  }

  // ── 1. getAddress ───────────────────────────────────────

  async getAddress(): Promise<{ address: string; addressHex: string }> {
    await this.init();
    return { address: this.address, addressHex: this.addressHex };
  }

  // ── 2. getAccount ───────────────────────────────────────

  async getAccount(address?: string): Promise<ChainAccountInfo> {
    await this.init();
    const addr = this.resolveAddress(address);

    const [account, resources] = await Promise.all([
      this.tronGridPost('/wallet/getaccount', { address: addr, visible: true }),
      this.tronGridPost('/wallet/getaccountresource', { address: addr, visible: true }),
    ]);

    // Empty response means unactivated account
    const isActivated = !!(account && account.address);
    const balanceSun: number = account.balance ?? 0;

    return {
      address: addr,
      balance_trx: String(balanceSun / SUN_PER_TRX),
      balance_sun: balanceSun,
      bandwidth: {
        free_net_used: resources.freeNetUsed ?? 0,
        free_net_limit: resources.freeNetLimit ?? 0,
        net_used: resources.NetUsed ?? 0,
        net_limit: resources.NetLimit ?? 0,
      },
      energy: {
        energy_used: resources.EnergyUsed ?? 0,
        energy_limit: resources.EnergyLimit ?? 0,
      },
      permissions: {
        owner: account.owner_permission ?? null,
        active: account.active_permission ?? null,
      },
      is_activated: isActivated,
    };
  }

  // ── 3. getTokens ────────────────────────────────────────

  async getTokens(address?: string): Promise<ChainTokensInfo> {
    await this.init();
    const addr = this.resolveAddress(address);

    const [v1Data, account] = await Promise.all([
      this.tronGridGet(`/v1/accounts/${addr}`),
      this.tronGridPost('/wallet/getaccount', { address: addr, visible: true }),
    ]);

    // TRC20 tokens from the v1 API
    const trc20: ChainTokensInfo['trc20'] = [];
    const trc20Array = v1Data?.data?.[0]?.trc20 ?? [];

    // Collect all contract addresses and balances first
    const trc20Raw: Array<{ contractAddr: string; balance: string }> = [];
    for (const entry of trc20Array) {
      for (const [contractAddr, balance] of Object.entries(entry)) {
        trc20Raw.push({ contractAddr, balance: String(balance) });
      }
    }

    // Query symbol/name/decimals for all TRC20 tokens in parallel
    const metadataResults = await Promise.all(
      trc20Raw.map((t) => this.queryTrc20Metadata(t.contractAddr)),
    );

    for (let i = 0; i < trc20Raw.length; i++) {
      const { contractAddr, balance } = trc20Raw[i];
      const meta = metadataResults[i];
      trc20.push({
        contract_address: contractAddr,
        symbol: meta.symbol,
        name: meta.name,
        balance,
        decimals: meta.decimals,
      });
    }

    // TRC10 tokens from account.assetV2
    const trc10: ChainTokensInfo['trc10'] = [];
    const assetV2 = account.assetV2 ?? [];
    for (const asset of assetV2) {
      trc10.push({ token_id: asset.key, name: asset.key, balance: String(asset.value) });
    }

    return { address: addr, trc10, trc20 };
  }

  /**
   * Query TRC20 token metadata (symbol, name, decimals) via constant contract calls.
   */
  private async queryTrc20Metadata(
    contractAddress: string,
  ): Promise<{ symbol: string; name: string; decimals: number }> {
    const callConstant = async (functionSelector: string): Promise<string> => {
      try {
        const result = await this.tronGridPost('/wallet/triggerconstantcontract', {
          owner_address: this.address,
          contract_address: contractAddress,
          function_selector: functionSelector,
          parameter: '',
          visible: true,
        });
        return result.constant_result?.[0] ?? '';
      } catch {
        return '';
      }
    };

    const [symbolHex, nameHex, decimalsHex] = await Promise.all([
      callConstant('symbol()'),
      callConstant('name()'),
      callConstant('decimals()'),
    ]);

    return {
      symbol: decodeAbiString(symbolHex),
      name: decodeAbiString(nameHex),
      decimals: decimalsHex ? Number(BigInt('0x' + (decimalsHex.slice(-64) || '0'))) : 0,
    };
  }

  // ── 4. send ─────────────────────────────────────────────

  async send(params: ChainSendParams): Promise<ChainTxResult> {
    await this.init();
    const tokenType = (params.token_type || 'TRX').toUpperCase();

    if (tokenType === 'TRX') {
      return this.sendTrx(params.to, params.amount);
    }
    if (tokenType === 'TRC10') {
      if (!params.token_id) {
        throw new Error('token_id is required for TRC10 transfers');
      }
      return this.sendTrc10(params.to, params.amount, params.token_id);
    }
    if (tokenType === 'TRC20') {
      if (!params.contract_address) {
        throw new Error('contract_address is required for TRC20 transfers');
      }
      return this.sendTrc20(params.to, params.amount, params.contract_address);
    }

    throw new Error(`Unsupported token_type: ${tokenType}`);
  }

  private async sendTrx(to: string, amount: string | number): Promise<ChainTxResult> {
    const amountSun = toSun(amount);

    const unsignedTx = await this.tronGridPost('/wallet/createtransaction', {
      owner_address: this.address,
      to_address: to,
      amount: amountSun,
      visible: true,
    });

    if (unsignedTx.Error) {
      throw new Error(String(unsignedTx.Error));
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      success: result.success,
      tx_id: result.txId,
      message: `Sent ${amount} TRX to ${to}`,
    };
  }

  private async sendTrc10(
    to: string,
    amount: string | number,
    tokenId: string,
  ): Promise<ChainTxResult> {
    const unsignedTx = await this.tronGridPost('/wallet/transferasset', {
      owner_address: this.address,
      to_address: to,
      asset_name: tokenId,
      amount: Number(amount),
      visible: true,
    });

    if (unsignedTx.Error) {
      throw new Error(String(unsignedTx.Error));
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      success: result.success,
      tx_id: result.txId,
      message: `Sent ${amount} TRC10(${tokenId}) to ${to}`,
    };
  }

  private async sendTrc20(
    to: string,
    amount: string | number,
    contractAddress: string,
  ): Promise<ChainTxResult> {
    // Encode parameter for transfer(address,uint256):
    //   20-byte address left-padded to 32 bytes + uint256 amount
    const toHex20 = to20ByteHex(to);
    const parameter = padHex(toHex20, 32) + uint256Hex(amount);

    const triggerResult = await this.tronGridPost('/wallet/triggersmartcontract', {
      owner_address: this.address,
      contract_address: contractAddress,
      function_selector: 'transfer(address,uint256)',
      parameter,
      fee_limit: 100_000_000,
      call_value: 0,
      visible: true,
    });

    if (triggerResult.result?.code) {
      const msg = triggerResult.result.message
        ? Buffer.from(triggerResult.result.message, 'hex').toString('utf8')
        : 'triggersmartcontract failed';
      throw new Error(msg);
    }

    const unsignedTx = triggerResult.transaction;
    if (!unsignedTx) {
      throw new Error('No transaction returned from triggersmartcontract');
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      success: result.success,
      tx_id: result.txId,
      message: `Sent ${amount} TRC20(${contractAddress}) to ${to}`,
    };
  }

  // ── 5. getTransaction ──────────────────────────────────

  async getTransaction(txId: string): Promise<ChainTransactionInfo> {
    const [tx, txInfo] = await Promise.all([
      this.tronGridPost('/wallet/gettransactionbyid', { value: txId }),
      this.tronGridPost('/wallet/gettransactioninfobyid', { value: txId }),
    ]);

    const contract = tx?.raw_data?.contract?.[0];
    return {
      tx_id: txId,
      block_number: txInfo?.blockNumber,
      timestamp: txInfo?.blockTimeStamp,
      contract_type: contract?.type,
      result: tx?.ret?.[0]?.contractRet,
      fee: txInfo?.fee,
      raw: { ...tx, info: txInfo },
    };
  }

  // ── 6. getHistory ──────────────────────────────────────

  async getHistory(params: ChainHistoryParams): Promise<ChainTransactionList> {
    await this.init();
    const addr = this.resolveAddress(params.address);
    const limit = params.limit ?? 20;

    const queryParts: string[] = [`limit=${limit}`];
    if (params.fingerprint) queryParts.push(`fingerprint=${params.fingerprint}`);
    if (params.only_to) queryParts.push('only_to=true');
    if (params.only_from) queryParts.push('only_from=true');

    const qs = queryParts.join('&');
    const data = await this.tronGridGet(`/v1/accounts/${addr}/transactions?${qs}`);

    return {
      address: addr,
      transactions: data.data ?? [],
      fingerprint: data.meta?.fingerprint ?? undefined,
    };
  }

  // ── 7. stake ───────────────────────────────────────────

  async stake(params: ChainStakeParams): Promise<ChainTxResult> {
    await this.init();
    const amountSun = toSun(params.amount_trx);
    const resource = params.resource || 'BANDWIDTH';

    let unsignedTx: Record<string, unknown>;

    if (params.action === 'freeze') {
      unsignedTx = await this.tronGridPost('/wallet/freezebalancev2', {
        owner_address: this.address,
        frozen_balance: amountSun,
        resource,
        visible: true,
      });
    } else if (params.action === 'unfreeze') {
      unsignedTx = await this.tronGridPost('/wallet/unfreezebalancev2', {
        owner_address: this.address,
        unfreeze_balance: amountSun,
        resource,
        visible: true,
      });
    } else {
      throw new Error(`Invalid stake action: ${params.action}`);
    }

    if (unsignedTx.Error) {
      throw new Error(String(unsignedTx.Error));
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      success: result.success,
      tx_id: result.txId,
      message: `${params.action} ${params.amount_trx} TRX for ${resource}`,
    };
  }

  // ── 8. resource ────────────────────────────────────────

  async resource(params: ChainResourceParams): Promise<ChainResourceResult> {
    await this.init();
    const resource = params.resource || 'BANDWIDTH';

    if (params.action === 'query') {
      const data = await this.tronGridPost('/wallet/getdelegatedresourcev2', {
        fromAddress: this.address,
        visible: true,
      });
      return {
        success: true,
        delegations: data.delegatedResource ?? [],
        message: `Queried delegations for ${this.address}`,
      };
    }

    if (!params.receiver) {
      throw new Error('receiver is required for delegate/undelegate');
    }
    if (params.amount_trx === undefined) {
      throw new Error('amount_trx is required for delegate/undelegate');
    }

    const amountSun = toSun(params.amount_trx);
    let unsignedTx: Record<string, unknown>;

    if (params.action === 'delegate') {
      const body: Record<string, unknown> = {
        owner_address: this.address,
        receiver_address: params.receiver,
        balance: amountSun,
        resource,
        lock: params.lock ?? false,
        visible: true,
      };
      unsignedTx = await this.tronGridPost('/wallet/delegateresource', body);
    } else if (params.action === 'undelegate') {
      unsignedTx = await this.tronGridPost('/wallet/undelegateresource', {
        owner_address: this.address,
        receiver_address: params.receiver,
        balance: amountSun,
        resource,
        visible: true,
      });
    } else {
      throw new Error(`Invalid resource action: ${params.action}`);
    }

    if (unsignedTx.Error) {
      throw new Error(String(unsignedTx.Error));
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      success: result.success,
      tx_id: result.txId,
      message: `${params.action} ${params.amount_trx} TRX ${resource} to ${params.receiver}`,
    };
  }

  // ── 9. swap (Router API + V2 fallback) ─────────────────

  async swap(params: ChainSwapParams): Promise<ChainSwapResult> {
    await this.init();
    const slippage = params.slippage ?? 0.5; // 0.5% default
    const amountIn = BigInt(params.amount);
    const isTrxIn = params.from_token.toUpperCase() === 'TRX';
    const isTrxOut = params.to_token.toUpperCase() === 'TRX';

    // Resolve token addresses for Router API
    const fromTokenAddr = isTrxIn ? this.swapConstants.trxAddress : params.from_token;
    const toTokenAddr = isTrxOut ? this.swapConstants.trxAddress : params.to_token;

    // Use Router API for estimate (finds optimal route across V2/V3/V4 pools)
    const routeResp = await fetchRouterAPI(
      this.swapConstants.routerApiUrl,
      fromTokenAddr,
      toTokenAddr,
      String(amountIn),
    );

    if (!routeResp.data || routeResp.data.length === 0) {
      throw new Error(
        `No swap route found for ${params.from_token} → ${params.to_token} (amount: ${params.amount}). ` +
        `No liquidity pool exists for this pair on ${detectNetwork(this.config.tronGridUrl)}.`,
      );
    }

    const bestRoute = routeResp.data[0];
    const expectedOutRaw = bestRoute.amountOutRaw;

    if (params.action === 'estimate') {
      return {
        action: 'estimate',
        from_token: params.from_token,
        to_token: params.to_token,
        amount_in: String(amountIn),
        expected_out: expectedOutRaw,
        success: true,
        message: `Route: ${bestRoute.symbols.join(' → ')} via ${bestRoute.poolVersions.join('+')}` +
          `, expected: ${bestRoute.amountOut}` +
          (bestRoute.impact ? `, price impact: ${bestRoute.impact}%` : ''),
      };
    }

    // Execute swap via V2 router
    const routerAddress = this.config.sunswapRouter || this.swapConstants.v2Router;
    const minOutBig = BigInt(expectedOutRaw) - (BigInt(expectedOutRaw) * BigInt(Math.round(slippage * 10))) / BigInt(1000);
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    // Build multi-hop V2 path from Router API tokens, replacing TRX with WTRX
    const path = bestRoute.tokens.map((t) =>
      t === this.swapConstants.trxAddress ? this.getWtrxAddress() : t,
    );

    let unsignedTx: Record<string, unknown>;

    if (isTrxIn) {
      const parameter =
        uint256Hex(minOutBig) +
        uint256Hex(128) +
        padHex(to20ByteHex(this.address), 32) +
        uint256Hex(deadline) +
        uint256Hex(path.length) +
        path.map((p) => padHex(to20ByteHex(p), 32)).join('');

      const triggerResult = await this.tronGridPost('/wallet/triggersmartcontract', {
        owner_address: this.address,
        contract_address: routerAddress,
        function_selector: 'swapExactETHForTokens(uint256,address[],address,uint256)',
        parameter,
        fee_limit: 150_000_000,
        call_value: Number(amountIn),
        visible: true,
      });

      if (triggerResult.result?.code) {
        const msg = triggerResult.result.message
          ? Buffer.from(triggerResult.result.message, 'hex').toString('utf8')
          : 'swap failed';
        throw new Error(msg);
      }
      unsignedTx = triggerResult.transaction;
    } else if (isTrxOut) {
      // Approve token to V2 router first
      await this.ensureTokenAllowance(params.from_token, routerAddress, amountIn);

      const parameter =
        uint256Hex(amountIn) +
        uint256Hex(minOutBig) +
        uint256Hex(160) +
        padHex(to20ByteHex(this.address), 32) +
        uint256Hex(deadline) +
        uint256Hex(path.length) +
        path.map((p) => padHex(to20ByteHex(p), 32)).join('');

      const triggerResult = await this.tronGridPost('/wallet/triggersmartcontract', {
        owner_address: this.address,
        contract_address: routerAddress,
        function_selector: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
        parameter,
        fee_limit: 150_000_000,
        call_value: 0,
        visible: true,
      });

      if (triggerResult.result?.code) {
        const msg = triggerResult.result.message
          ? Buffer.from(triggerResult.result.message, 'hex').toString('utf8')
          : 'swap failed';
        throw new Error(msg);
      }
      unsignedTx = triggerResult.transaction;
    } else {
      // Token → Token: approve first
      await this.ensureTokenAllowance(params.from_token, routerAddress, amountIn);

      const parameter =
        uint256Hex(amountIn) +
        uint256Hex(minOutBig) +
        uint256Hex(160) +
        padHex(to20ByteHex(this.address), 32) +
        uint256Hex(deadline) +
        uint256Hex(path.length) +
        path.map((p) => padHex(to20ByteHex(p), 32)).join('');

      const triggerResult = await this.tronGridPost('/wallet/triggersmartcontract', {
        owner_address: this.address,
        contract_address: routerAddress,
        function_selector: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
        parameter,
        fee_limit: 150_000_000,
        call_value: 0,
        visible: true,
      });

      if (triggerResult.result?.code) {
        const msg = triggerResult.result.message
          ? Buffer.from(triggerResult.result.message, 'hex').toString('utf8')
          : 'swap failed';
        throw new Error(msg);
      }
      unsignedTx = triggerResult.transaction;
    }

    if (!unsignedTx) {
      throw new Error('No transaction returned from swap trigger');
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      action: 'execute',
      from_token: params.from_token,
      to_token: params.to_token,
      amount_in: String(amountIn),
      expected_out: expectedOutRaw,
      tx_id: result.txId,
      success: true,
      message: `Route: ${bestRoute.symbols.join(' → ')} via ${bestRoute.poolVersions.join('+')}`,
    };
  }

  private async ensureTokenAllowance(
    tokenAddress: string,
    spender: string,
    requiredAmount: bigint,
  ): Promise<void> {
    // Check current allowance
    const allowanceParam =
      padHex(to20ByteHex(this.address), 32) +
      padHex(to20ByteHex(spender), 32);

    const allowanceResult = await this.tronGridPost('/wallet/triggerconstantcontract', {
      owner_address: this.address,
      contract_address: tokenAddress,
      function_selector: 'allowance(address,address)',
      parameter: allowanceParam,
      visible: true,
    });

    const allowanceHex = allowanceResult.constant_result?.[0] ?? '0';
    const currentAllowance = BigInt('0x' + (allowanceHex || '0'));

    if (currentAllowance >= requiredAmount) return;

    // Approve max uint256
    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    const approveParam =
      padHex(to20ByteHex(spender), 32) +
      uint256Hex(maxUint256);

    const triggerResult = await this.tronGridPost('/wallet/triggersmartcontract', {
      owner_address: this.address,
      contract_address: tokenAddress,
      function_selector: 'approve(address,uint256)',
      parameter: approveParam,
      fee_limit: 100_000_000,
      call_value: 0,
      visible: true,
    });

    if (triggerResult.result?.code) {
      const msg = triggerResult.result.message
        ? Buffer.from(triggerResult.result.message, 'hex').toString('utf8')
        : 'approve failed';
      throw new Error(`Token approval failed: ${msg}`);
    }

    const unsignedTx = triggerResult.transaction;
    if (!unsignedTx) throw new Error('No transaction returned from approve');

    await this.signAndBroadcast(unsignedTx);
    // Wait for approval to be confirmed
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  private buildSwapPath(fromToken: string, toToken: string): string[] {
    const resolvedFrom = fromToken.toUpperCase() === 'TRX' ? this.getWtrxAddress() : fromToken;
    const resolvedTo = toToken.toUpperCase() === 'TRX' ? this.getWtrxAddress() : toToken;
    return [resolvedFrom, resolvedTo];
  }

  // ── 10. setupMultisig ──────────────────────────────────

  async setupMultisig(params: ChainSetupMultisigParams): Promise<ChainTxResult> {
    await this.init();
    const keys = [
      { address: this.address, weight: 1 },
      ...params.cosigner_addresses.map((addr) => ({ address: addr, weight: 1 })),
    ];

    const unsignedTx = await this.tronGridPost('/wallet/accountpermissionupdate', {
      owner_address: this.address,
      owner: {
        type: 0,
        permission_name: 'owner',
        threshold: 1,
        keys: [{ address: this.address, weight: 1 }],
      },
      actives: [
        {
          type: 2,
          permission_name: params.permission_name || 'active0',
          threshold: params.threshold,
          operations:
            '7fff1fc0033e0000000000000000000000000000000000000000000000000000',
          keys,
        },
      ],
      visible: true,
    });

    if (unsignedTx.Error) {
      throw new Error(String(unsignedTx.Error));
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      success: result.success,
      tx_id: result.txId,
      message: `Multisig configured: threshold=${params.threshold}, cosigners=${params.cosigner_addresses.join(',')}`,
    };
  }

  // ── 11. createMultisigTx ───────────────────────────────

  async createMultisigTx(params: ChainCreateMultisigTxParams): Promise<ChainUnsignedTxResult> {
    await this.init();
    const unsignedTx = await this.tronGridPost('/wallet/createtransaction', {
      owner_address: this.address,
      to_address: params.to,
      amount: params.amount_sun,
      Permission_id: params.permission_id ?? 2,
      visible: true,
    });

    if (unsignedTx.Error) {
      throw new Error(String(unsignedTx.Error));
    }

    return {
      transaction: unsignedTx,
      tx_id: unsignedTx.txID,
    };
  }

  // ── 12. signMultisigTx ────────────────────────────────

  async signMultisigTx(params: ChainSignMultisigTxParams): Promise<ChainSignedTxResult> {
    let signingWallet: Wallet;
    if (params.use_cosigner) {
      if (!this.config.cosignerWallet) {
        throw new Error('Cosigner wallet not configured. Provide cosignerWallet in OnChainConfig.');
      }
      signingWallet = this.config.cosignerWallet;
    } else {
      signingWallet = this.wallet;
    }

    // Sign a clean copy (without existing signatures) to get the new signature
    const cleanTx = { ...params.transaction, signature: undefined };
    const signedTx = await signTxWithWallet(signingWallet, cleanTx);
    const newSignature = (signedTx.signature as string[])[0];

    const existingSignatures = (params.transaction.signature as string[]) || [];
    const finalTx = {
      ...params.transaction,
      signature: [...existingSignatures, newSignature],
    };

    return {
      transaction: finalTx,
      tx_id: params.transaction.txID as string,
      signature: newSignature,
    };
  }

  // ── 13. getStakingInfo ────────────────────────────────

  async getStakingInfo(address?: string): Promise<ChainStakingInfo> {
    await this.init();
    const addr = address || this.address;

    const account = await this.tronGridPost('/wallet/getaccount', {
      address: addr,
      visible: true,
    });

    // Parse Stake 2.0 frozen balance
    const frozenV2 = account.frozenV2 ?? [];
    let frozenBandwidthSun = 0;
    let frozenEnergySun = 0;

    for (const frozen of frozenV2) {
      const amount = frozen.amount ?? 0;
      if (frozen.type === 'ENERGY' || frozen.type === 1) {
        frozenEnergySun += amount;
      } else {
        // type === 'BANDWIDTH' or undefined (default is BANDWIDTH)
        frozenBandwidthSun += amount;
      }
    }

    // Parse votes
    const votes: Array<{ sr_address: string; vote_count: number }> = [];
    for (const vote of account.votes ?? []) {
      votes.push({
        sr_address: vote.vote_address ?? '',
        vote_count: vote.vote_count ?? 0,
      });
    }

    // Parse pending unfreezing (Stake 2.0)
    const unfreezeV2 = account.unfrozenV2 ?? [];
    const unfreezePending: ChainStakingInfo['unfreeze_pending'] = [];
    for (const uf of unfreezeV2) {
      unfreezePending.push({
        resource: uf.type === 'ENERGY' || uf.type === 1 ? 'ENERGY' : 'BANDWIDTH',
        unfreeze_amount_sun: uf.unfreeze_amount ?? 0,
        unfreeze_expire_time: uf.unfreeze_expire_time ?? 0,
      });
    }

    // Canwithdraw amount
    const canWithdrawSun = account.can_withdraw_unfrozen_amount ?? 0;

    return {
      address: addr,
      frozen_bandwidth_sun: frozenBandwidthSun,
      frozen_energy_sun: frozenEnergySun,
      frozen_bandwidth_trx: String(frozenBandwidthSun / 1_000_000),
      frozen_energy_trx: String(frozenEnergySun / 1_000_000),
      total_frozen_trx: String((frozenBandwidthSun + frozenEnergySun) / 1_000_000),
      votes,
      unfreeze_pending: unfreezePending,
      can_withdraw_amount_sun: canWithdrawSun,
    };
  }

  // ── 14. swapV3 (Router API + V3 router execution) ──────

  async swapV3(params: ChainSwapV3Params): Promise<ChainSwapV3Result> {
    await this.init();
    const feeTier = params.fee_tier ?? 3000;
    const slippage = params.slippage ?? 0.5;
    const amountIn = BigInt(params.amount);
    const isTrxIn = params.from_token.toUpperCase() === 'TRX';
    const isTrxOut = params.to_token.toUpperCase() === 'TRX';

    // Resolve token addresses for Router API
    const fromTokenAddr = isTrxIn ? this.swapConstants.trxAddress : params.from_token;
    const toTokenAddr = isTrxOut ? this.swapConstants.trxAddress : params.to_token;

    // Use Router API for estimate
    const routeResp = await fetchRouterAPI(
      this.swapConstants.routerApiUrl,
      fromTokenAddr,
      toTokenAddr,
      String(amountIn),
    );

    if (!routeResp.data || routeResp.data.length === 0) {
      throw new Error(
        `No swap route found for ${params.from_token} → ${params.to_token} (amount: ${params.amount}).`,
      );
    }

    const bestRoute = routeResp.data[0];
    const expectedOutRaw = bestRoute.amountOutRaw;

    if (params.action === 'estimate') {
      return {
        action: 'estimate',
        from_token: params.from_token,
        to_token: params.to_token,
        amount_in: String(amountIn),
        expected_out: expectedOutRaw,
        fee_tier: feeTier,
        success: true,
        price_impact: bestRoute.impact || undefined,
        message: `Route: ${bestRoute.symbols.join(' → ')} via ${bestRoute.poolVersions.join('+')}` +
          `, expected: ${bestRoute.amountOut}`,
      };
    }

    // Execute via V3 router
    const routerAddress = this.config.sunswapV3Router || this.swapConstants.v3Router;
    const minOut = BigInt(expectedOutRaw) - (BigInt(expectedOutRaw) * BigInt(Math.round(slippage * 10))) / BigInt(1000);
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    const sqrtPriceLimit = params.sqrt_price_limit ? BigInt(params.sqrt_price_limit) : BigInt(0);
    const tokenIn = isTrxIn ? this.getWtrxAddress() : params.from_token;
    const tokenOut = isTrxOut ? this.getWtrxAddress() : params.to_token;

    // Approve token to V3 router if not TRX
    if (!isTrxIn) {
      await this.ensureTokenAllowance(params.from_token, routerAddress, amountIn);
    }

    const parameter =
      padHex(to20ByteHex(tokenIn), 32) +
      padHex(to20ByteHex(tokenOut), 32) +
      uint256Hex(feeTier) +
      padHex(to20ByteHex(this.address), 32) +
      uint256Hex(deadline) +
      uint256Hex(amountIn) +
      uint256Hex(minOut) +
      uint256Hex(sqrtPriceLimit);

    const callValue = isTrxIn ? Number(amountIn) : 0;

    const triggerResult = await this.tronGridPost('/wallet/triggersmartcontract', {
      owner_address: this.address,
      contract_address: routerAddress,
      function_selector: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
      parameter,
      fee_limit: 200_000_000,
      call_value: callValue,
      visible: true,
    });

    if (triggerResult.result?.code) {
      const msg = triggerResult.result.message
        ? Buffer.from(triggerResult.result.message, 'hex').toString('utf8')
        : 'SunSwap V3 swap failed';
      throw new Error(msg);
    }

    const unsignedTx = triggerResult.transaction;
    if (!unsignedTx) {
      throw new Error('No transaction returned from SunSwap V3 trigger');
    }

    const result = await this.signAndBroadcast(unsignedTx);
    return {
      action: 'execute',
      from_token: params.from_token,
      to_token: params.to_token,
      amount_in: String(amountIn),
      expected_out: expectedOutRaw,
      fee_tier: feeTier,
      tx_id: result.txId,
      success: true,
      price_impact: bestRoute.impact || undefined,
      message: `Route: ${bestRoute.symbols.join(' → ')} via ${bestRoute.poolVersions.join('+')}`,
    };
  }

  private getWtrxAddress(): string {
    return this.config.wtrxAddress || this.swapConstants.wtrx;
  }
}
