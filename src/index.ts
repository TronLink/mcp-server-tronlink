#!/usr/bin/env node

import * as path from 'node:path';
import * as fs from 'node:fs';

// All environment variables are injected via MCP JSON config (env field).
// See .env.example for the full list of supported variables.

import {
  createMcpServer,
  setSessionManager,
  KnowledgeStore,
  setKnowledgeStore,
  KNOWLEDGE_DIR,
} from '@tronlink/mcp-core';
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
 * All environment variables are injected via MCP JSON config (env field).
 * See .env.example for the full list of supported variables.
 */

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

  // Set up multisig capability if credentials provided
  const msBaseURL = process.env.TL_MULTISIG_BASE_URL;
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
          tronGridUrl: process.env.TL_TRONGRID_URL,
          tronGridApiKey: process.env.TL_TRONGRID_API_KEY,
          ownerKey: process.env.TL_MULTISIG_OWNER_KEY,
          cosignerKey: process.env.TL_MULTISIG_COSIGNER_KEY,
        })
      : undefined;

  if (multiSigCapability) {
    logger(`MultiSig enabled: ${msBaseURL}`);
    if (process.env.TL_TRONGRID_URL) {
      logger(`TronGrid: ${process.env.TL_TRONGRID_URL}`);
    }
  }

  // Set up on-chain capability if private key provided
  const chainPrivateKey = process.env.TL_CHAIN_PRIVATE_KEY;
  const chainGridUrl = process.env.TL_TRONGRID_URL;

  const onChainCapability =
    chainPrivateKey && chainGridUrl
      ? new TronLinkOnChainCapability({
          privateKey: chainPrivateKey,
          tronGridUrl: chainGridUrl,
          tronGridApiKey: process.env.TL_TRONGRID_API_KEY,
          cosignerKey: process.env.TL_MULTISIG_COSIGNER_KEY,
          sunswapRouter: process.env.TL_SUNSWAP_ROUTER,
          sunswapV3Router: process.env.TL_SUNSWAP_V3_ROUTER,
          wtrxAddress: process.env.TL_WTRX_ADDRESS,
        })
      : undefined;

  if (onChainCapability) {
    logger(`On-chain mode enabled: ${chainGridUrl}`);
  }

  // Set up GasFree capability if configured
  const gasFreeBaseUrl = process.env.TL_GASFREE_BASE_URL;
  const gasFreeCapability =
    gasFreeBaseUrl && chainPrivateKey
      ? new TronLinkGasFreeCapability({
          baseUrl: gasFreeBaseUrl,
          privateKey: chainPrivateKey,
          apiKey: process.env.TL_GASFREE_API_KEY,
          apiSecret: process.env.TL_GASFREE_API_SECRET,
        })
      : undefined;

  if (gasFreeCapability) {
    logger(`GasFree enabled: ${gasFreeBaseUrl}`);
  }

  // Create session manager
  const sessionManager = new TronLinkSessionManager({
    extensionPath,
    mode,
    headless,
    slowMo,
    capabilities: {
      build: buildCapability,
      stateSnapshot,
      multiSig: multiSigCapability,
      onChain: onChainCapability,
      gasFree: gasFreeCapability,
    },
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
