#!/usr/bin/env node

import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// All environment variables are injected via MCP JSON config (env field).
// See .env.example for the full list of supported variables.

import {
  createMcpServer,
  setSessionManager,
  KnowledgeStore,
  setKnowledgeStore,
  KNOWLEDGE_DIR,
} from '@tronlink/tronlink-mcp-core';
import type { Wallet } from '@bankofai/agent-wallet';
import { resolveSecureWallet } from './wallet.js';
import { getWalletToolDefinitions } from './wallet-tools.js';
import { TronLinkSessionManager } from './session-manager.js';
import { TronLinkBuildCapability } from './capabilities/build.js';
import { TronLinkStateSnapshotCapability } from './capabilities/state-snapshot.js';
import { TronLinkMultiSigCapability } from './capabilities/multisig.js';
import { TronLinkOnChainCapability } from './capabilities/on-chain.js';
import { TronLinkGasFreeCapability } from './capabilities/gasfree.js';
import { registerFlows } from './flows/index.js';

/**
 * TronLink MCP Server
 *
 * Private keys / mnemonics are managed by @bankofai/agent-wallet.
 * Keys are encrypted at rest and never stored as plain text in config.
 *
 * Setup:
 *   1. npm install -g @bankofai/agent-wallet
 *   2. agent-wallet start local_secure --generate --wallet-id main
 *   3. Set AGENT_WALLET_PASSWORD in MCP env config
 *
 * See .env.example for the full list of supported variables.
 */

/** Detect TRON network string from TronGrid URL. */
function detectTronNetwork(tronGridUrl?: string): string {
  if (!tronGridUrl) return 'tron:mainnet';
  const lower = tronGridUrl.toLowerCase();
  if (lower.includes('nile')) return 'tron:nile';
  if (lower.includes('shasta')) return 'tron:shasta';
  return 'tron:mainnet';
}

/** Log active wallet address and network faucet info on startup. */
function logWalletInfo(
  logger: (msg: string) => void,
  address: string,
  network: string,
  tronGridUrl?: string,
) {
  const networkLabel =
    network.includes('nile') ? 'Nile Testnet' :
    network.includes('shasta') ? 'Shasta Testnet' :
    'Mainnet';

  logger('════════════════════════════════════════════');
  logger(`Active wallet: ${address}`);
  logger(`Network: ${networkLabel}${tronGridUrl ? ` (${tronGridUrl})` : ''}`);

  if (network.includes('nile')) {
    logger(`Faucet: https://nileex.io/join/getJoinPage`);
  } else if (network.includes('shasta')) {
    logger(`Faucet: https://www.trongrid.io/shasta`);
  }
  logger('════════════════════════════════════════════');
}

function buildWalletSetupMessage(): string {
  return (
    'Wallet not available. IMPORTANT: Ask the user which option they prefer before proceeding.\n' +
    '  Option A (auto): Call tl_wallet_create to auto-create a wallet under ~/.agent-wallet/\n' +
    '  Option B (manual):\n' +
    '    1. Install agent-wallet and create an account locally\n' +
    '    2. Add AGENT_WALLET_PASSWORD to your .mcp.json env\n' +
    '    3. Restart Claude Code'
  );
}

function isWalletDependentTool(name: string): boolean {
  return name.startsWith('tl_chain_') || name.startsWith('tl_gasfree_');
}

async function main() {
  const logger = (msg: string) => process.stderr.write(`[tronlink-mcp] ${msg}\n`);

  // Resolve extension path
  const extensionPath = resolveExtensionPath();
  logger(`Extension path: ${extensionPath}`);

  const mode = (process.env.TL_MODE || 'prod') as 'e2e' | 'prod';
  const headless = process.env.TL_HEADLESS === 'true';
  const slowMo = parseInt(process.env.TL_SLOW_MO || '0', 10);

  // Set up capabilities
  const sourcePath = process.env.TRONLINK_SOURCE_PATH;
  const buildCapability = sourcePath
    ? new TronLinkBuildCapability(sourcePath, extensionPath)
    : undefined;

  const stateSnapshot = new TronLinkStateSnapshotCapability();

  // Resolve wallets via agent-wallet
  const chainGridUrl = process.env.TL_TRONGRID_URL;
  const tronNetwork = detectTronNetwork(chainGridUrl);

  // Resolve the main wallet — when any capability needs signing
  const gasFreeBaseUrl = process.env.TL_GASFREE_BASE_URL;
  const msBaseURL = process.env.TL_MULTISIG_BASE_URL;
  const needsWallet = !!(chainGridUrl || gasFreeBaseUrl || msBaseURL);
  let walletSetupRequired = false;
  const walletSetupMessage = buildWalletSetupMessage();

  let mainWallet: Wallet | undefined;
  if (needsWallet) {
    try {
      mainWallet = await resolveSecureWallet(tronNetwork);
      const addr = await mainWallet.getAddress();
      logWalletInfo(logger, addr, tronNetwork, chainGridUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNoPassword = msg.includes('No wallet password available');
      const isNoWallet = msg.includes('No wallets in encrypted storage');

      if (isNoPassword || isNoWallet) {
        walletSetupRequired = true;
        // No wallet — show guidance, let user trigger creation via MCP tool or CLI
        logger('════════════════════════════════════════════');
        logger('No wallet configured. Choose one option:');
        logger('');
        logger('  Option A — Auto-create via MCP tool:');
        logger('    Call tl_wallet_create to auto-create a wallet under ~/.agent-wallet/');
        logger('');
        logger('  Option B — Manual setup:');
        logger('    1. Install agent-wallet and create an account locally');
        logger('    2. Add AGENT_WALLET_PASSWORD to your .mcp.json env');
        logger('    3. Restart the MCP server');
        logger('════════════════════════════════════════════');
      } else {
        // Real error (wrong password, decryption failure, etc.)
        logger(`Wallet error: ${msg}`);
      }
    }
  }

  // Resolve cosigner wallet if configured
  let cosignerWallet: Wallet | undefined;
  const cosignerWalletId = process.env.TL_COSIGNER_WALLET_ID;
  if (cosignerWalletId) {
    try {
      cosignerWallet = await resolveSecureWallet(tronNetwork, cosignerWalletId);
      const addr = await cosignerWallet.getAddress();
      logger(`Cosigner wallet resolved: ${addr}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger(`WARNING: Could not resolve cosigner wallet "${cosignerWalletId}": ${detail}`);
    }
  }

  // Resolve owner wallet for multisig (can be different from main wallet)
  let ownerWallet: Wallet | undefined;
  const ownerWalletId = process.env.TL_OWNER_WALLET_ID;
  if (ownerWalletId) {
    try {
      ownerWallet = await resolveSecureWallet(tronNetwork, ownerWalletId);
      const addr = await ownerWallet.getAddress();
      logger(`Owner wallet resolved: ${addr}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger(`WARNING: Could not resolve owner wallet "${ownerWalletId}": ${detail}`);
    }
  } else {
    // Default: use main wallet as owner
    ownerWallet = mainWallet;
  }

  // Set up multisig capability if credentials provided
  const msSecretId = process.env.TL_MULTISIG_SECRET_ID;
  const msSecretKey = process.env.TL_MULTISIG_SECRET_KEY;
  const msChannel = process.env.TL_MULTISIG_CHANNEL;

  const multiSigCapability =
    msBaseURL && msSecretId && msSecretKey && msChannel
      ? new TronLinkMultiSigCapability({
          baseURL: msBaseURL,
          secretId: msSecretId,
          secretKey: msSecretKey,
          channel: msChannel,
          tronGridUrl: chainGridUrl,
          tronGridApiKey: process.env.TL_TRONGRID_API_KEY,
          ownerWallet,
          cosignerWallet,
        })
      : undefined;

  if (multiSigCapability) {
    logger(`MultiSig enabled: ${msBaseURL}`);
    if (chainGridUrl) {
      logger(`TronGrid: ${chainGridUrl}`);
    }
  }

  // Set up on-chain capability if wallet is available
  let onChainCapability: TronLinkOnChainCapability | undefined =
    mainWallet && chainGridUrl
      ? new TronLinkOnChainCapability({
          wallet: mainWallet,
          tronGridUrl: chainGridUrl,
          tronGridApiKey: process.env.TL_TRONGRID_API_KEY,
          cosignerWallet,
          sunswapRouter: process.env.TL_SUNSWAP_ROUTER,
          sunswapV3Router: process.env.TL_SUNSWAP_V3_ROUTER,
          wtrxAddress: process.env.TL_WTRX_ADDRESS,
        })
      : undefined;

  if (onChainCapability) {
    logger(`On-chain mode enabled: ${chainGridUrl}`);
  }

  // Set up GasFree capability if configured
  let gasFreeCapability: TronLinkGasFreeCapability | undefined =
    gasFreeBaseUrl && mainWallet
      ? new TronLinkGasFreeCapability({
          baseUrl: gasFreeBaseUrl,
          wallet: mainWallet,
          apiKey: process.env.TL_GASFREE_API_KEY,
          apiSecret: process.env.TL_GASFREE_API_SECRET,
        })
      : undefined;

  if (gasFreeCapability) {
    logger(`GasFree enabled: ${gasFreeBaseUrl}`);
  }

  // Mutable capabilities object — shared by reference with sessionManager.
  // onWalletSwap can create missing capabilities after tl_wallet_create.
  const capabilities: {
    build?: typeof buildCapability;
    stateSnapshot?: typeof stateSnapshot;
    multiSig?: typeof multiSigCapability;
    onChain?: TronLinkOnChainCapability;
    gasFree?: TronLinkGasFreeCapability;
  } = {
    build: buildCapability,
    stateSnapshot,
    multiSig: multiSigCapability,
    onChain: onChainCapability,
    gasFree: gasFreeCapability,
  };

  // Create session manager
  const sessionManager = new TronLinkSessionManager({
    extensionPath,
    mode,
    headless,
    slowMo,
    capabilities,
  });

  // Register session manager
  setSessionManager(sessionManager);

  // Set up knowledge store
  const knowledgeStore = new KnowledgeStore(KNOWLEDGE_DIR);
  setKnowledgeStore(knowledgeStore);

  // Register flow recipes
  registerFlows();
  logger('Flow recipes registered');

  // Create MCP server
  const server = createMcpServer({
    name: 'TronLink MCP Server',
    version: '0.1.0',
    logger,
    onCleanup: async () => {
      logger('Server shutting down...');
    },
  });

  // Register wallet management tools with hot-swap callback.
  // When capabilities were not created at startup (no wallet), create them now.
  const onWalletSwap = (newWallet: import('@bankofai/agent-wallet').Wallet) => {
    // On-chain: swap or create
    if (onChainCapability) {
      onChainCapability.swapWallet(newWallet);
    } else if (chainGridUrl) {
      onChainCapability = new TronLinkOnChainCapability({
        wallet: newWallet,
        tronGridUrl: chainGridUrl,
        tronGridApiKey: process.env.TL_TRONGRID_API_KEY,
        cosignerWallet,
        sunswapRouter: process.env.TL_SUNSWAP_ROUTER,
        sunswapV3Router: process.env.TL_SUNSWAP_V3_ROUTER,
        wtrxAddress: process.env.TL_WTRX_ADDRESS,
      });
      capabilities.onChain = onChainCapability;
      logger(`On-chain mode enabled (late init): ${chainGridUrl}`);
    }

    // GasFree: swap or create
    if (gasFreeCapability) {
      gasFreeCapability.swapWallet(newWallet);
    } else if (gasFreeBaseUrl) {
      gasFreeCapability = new TronLinkGasFreeCapability({
        baseUrl: gasFreeBaseUrl,
        wallet: newWallet,
        apiKey: process.env.TL_GASFREE_API_KEY,
        apiSecret: process.env.TL_GASFREE_API_SECRET,
      });
      capabilities.gasFree = gasFreeCapability;
      logger(`GasFree enabled (late init): ${gasFreeBaseUrl}`);
    }

    // MultiSig: swap only (requires credentials beyond just a wallet)
    if (multiSigCapability) multiSigCapability.swapWallets(newWallet);

    logger(`Capabilities updated with new wallet`);
  };
  const walletToolDefs = getWalletToolDefinitions(server.getToolPrefix(), tronNetwork, onWalletSwap);
  const walletHandlers = new Map(walletToolDefs.map(d => [d.name, d.handler]));

  // Build core handler map (once)
  const coreHandlers = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  for (const def of server.getToolDefinitions()) {
    if ('handler' in def && typeof def.handler === 'function') {
      coreHandlers.set(def.name, def.handler as (input: Record<string, unknown>) => Promise<unknown>);
    }
  }

  // Extend tool list with wallet tools
  const toolDefs = server.getToolDefinitions() as unknown[];
  for (const def of walletToolDefs) {
    toolDefs.push({ name: def.name, description: def.description, inputSchema: def.inputSchema });
  }

  // Override CallTool handler to route wallet tools + core tools
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const sdkServer = server.getServer();

  // Re-register ListTools to include wallet tools
  sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (server.getToolDefinitions() as Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>)
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  // Route tool calls: wallet tools first, then core
  sdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args || {}) as Record<string, unknown>;

    // Check wallet tools
    const walletHandler = walletHandlers.get(name);
    if (walletHandler) {
      const response = await walletHandler(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
        isError: !response.ok,
      };
    }

    // Check core tools
    const coreHandler = coreHandlers.get(name);
    if (coreHandler) {
      const response = (await coreHandler(input)) as { ok: boolean; error?: { code: string; message: string } };

      // Replace wallet-unavailable responses with unified wallet setup guidance.
      if (
        !response.ok &&
        response.error &&
        isWalletDependentTool(name) &&
        (
          response.error.message.includes('TL_CHAIN_PRIVATE_KEY') ||
          (walletSetupRequired && response.error.code === 'TL_CAPABILITY_NOT_AVAILABLE')
        )
      ) {
        response.error.message = walletSetupMessage;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
        isError: !response.ok,
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ok: false,
          error: { code: 'TL_INVALID_INPUT', message: `Unknown tool: ${name}` },
          meta: { timestamp: new Date().toISOString(), durationMs: 0 },
        }),
      }],
      isError: true,
    };
  });

  logger(`Wallet tools registered: ${walletToolDefs.map(d => d.name).join(', ')}`);

  // Start serving
  await server.start();
  logger('Server ready. Waiting for MCP client connections...');
}

function resolveExtensionPath(): string {
  // Check environment variable first
  if (process.env.TRONLINK_EXTENSION_PATH) {
    const p = path.resolve(process.env.TRONLINK_EXTENSION_PATH);
    if (fs.existsSync(p)) return p;
    process.stderr.write(
      `[tronlink-mcp] WARNING: TRONLINK_EXTENSION_PATH="${p}" does not exist\n`,
    );
  }

  // Check common locations
  const candidates = [
    // Relative to current directory
    path.resolve('dist'),
    path.resolve('dist/prd'),
    // TronLink extension pro default locations (sibling)
    path.resolve('../tronlink-extension-pro/dist'),
    path.resolve('../tronlink-extension-pro/dist/prd'),
    // From tronlinkai workspace (up two levels from src)
    path.resolve(__dirname, '../../tronlink-extension-pro/dist'),
    path.resolve(__dirname, '../../tronlink-extension-pro/dist/prd'),
    // Parent workspace (e.g. tronlinkai/mcp-server-tronlink -> tronlink/tronlink-extension-pro)
    path.resolve('../../tronlink-extension-pro/dist'),
    path.resolve('../../tronlink-extension-pro/dist/prd'),
    // Three levels up from __dirname (dist/index.js -> mcp-server-tronlink -> tronlinkai -> tronlink)
    path.resolve(__dirname, '../../../tronlink-extension-pro/dist'),
    path.resolve(__dirname, '../../../tronlink-extension-pro/dist/prd'),
  ];

  for (const candidate of candidates) {
    const manifestPath = path.join(candidate, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      return candidate;
    }
  }

  // Default fallback
  process.stderr.write(
    '[tronlink-mcp] WARNING: No extension build found. Set TRONLINK_EXTENSION_PATH.\n',
  );
  return path.resolve('dist');
}

main().catch((error) => {
  process.stderr.write(
    `[tronlink-mcp] Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
