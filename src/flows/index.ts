import { getFlowRegistry } from '@tronlink/mcp-core';
import { importWalletFlow } from './import-wallet.js';
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
  importWalletFlow,
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
  importWalletFlow,
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
