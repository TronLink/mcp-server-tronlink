import { getFlowRegistry } from '@tronlink/tronlink-mcp-core';
// NOTE: importWalletFlow removed — it passes a private key through the MCP
// call chain into the browser, which violates the encrypted-wallet-only policy.
import {
  switchNetworkFlow,
  enableTestNetworksFlow,
} from './switch-network.js';
import { transferTrxFlow, transferTokenFlow } from './transfer-trx.js';
import {
  multisigQueryAuthFlow,
  multisigListTransactionsFlow,
  multisigMonitorFlow,
  multisigStopMonitorFlow,
  multisigSubmitTxFlow,
  multisigCheckFlow,
} from './multisig.js';
import {
  chainCheckBalanceFlow,
  chainTransferTrxFlow,
  chainTransferTrc20Flow,
  chainStakeFlow,
  chainUnstakeFlow,
  chainGetStakingFlow,
  chainDelegateResourceFlow,
  chainUndelegateResourceFlow,
  chainSetupMultisigFlow,
  chainCreateMultisigTxFlow,
  chainSwapV3Flow,
} from './onchain.js';
import {
  gasfreeCheckAccountFlow,
  gasfreeTransactionHistoryFlow,
  gasfreeSendFlow,
} from './gasfree.js';

/**
 * All built-in flow recipes for TronLink MCP Server.
 */
export const builtinFlows = [
  enableTestNetworksFlow,
  switchNetworkFlow,
  transferTrxFlow,
  transferTokenFlow,
  // Multisig flows
  multisigQueryAuthFlow,
  multisigListTransactionsFlow,
  multisigMonitorFlow,
  multisigStopMonitorFlow,
  multisigSubmitTxFlow,
  multisigCheckFlow,
  // On-chain flows
  chainCheckBalanceFlow,
  chainTransferTrxFlow,
  chainTransferTrc20Flow,
  chainStakeFlow,
  chainUnstakeFlow,
  chainGetStakingFlow,
  chainDelegateResourceFlow,
  chainUndelegateResourceFlow,
  chainSetupMultisigFlow,
  chainCreateMultisigTxFlow,
  chainSwapV3Flow,
  // GasFree flows
  gasfreeCheckAccountFlow,
  gasfreeTransactionHistoryFlow,
  gasfreeSendFlow,
];

/**
 * Register all TronLink flow recipes with the core FlowRegistry.
 * Called during server startup.
 */
export function registerFlows(): void {
  const registry = getFlowRegistry();
  registry.registerAll(builtinFlows);
}

export {
  switchNetworkFlow,
  enableTestNetworksFlow,
  transferTrxFlow,
  transferTokenFlow,
  multisigQueryAuthFlow,
  multisigListTransactionsFlow,
  multisigMonitorFlow,
  multisigStopMonitorFlow,
  multisigSubmitTxFlow,
  multisigCheckFlow,
  chainCheckBalanceFlow,
  chainTransferTrxFlow,
  chainTransferTrc20Flow,
  chainStakeFlow,
  chainUnstakeFlow,
  chainGetStakingFlow,
  chainDelegateResourceFlow,
  chainUndelegateResourceFlow,
  chainSetupMultisigFlow,
  chainCreateMultisigTxFlow,
  chainSwapV3Flow,
  gasfreeCheckAccountFlow,
  gasfreeTransactionHistoryFlow,
  gasfreeSendFlow,
};
