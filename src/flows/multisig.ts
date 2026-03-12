import type { FlowRecipe } from '@tronlink/mcp-core';

/**
 * Flow recipe: Query multisig permissions for an address.
 *
 * Returns the owner/active permissions, thresholds, and weights
 * for all multisig relationships involving the queried address.
 */
export const multisigQueryAuthFlow: FlowRecipe = {
  id: 'multisig_query_auth',
  name: 'Query Multisig Permissions',
  description:
    'Query multisig permissions for a TRON address. Returns which addresses it controls, ' +
    'permission details (owner/active), thresholds, and signer weights.',
  context: 'both',
  preconditions: [
    'MultiSig capability is configured (BASE_URL, SECRET_ID, SECRET_KEY, CHANNEL)',
    'Address is a valid TRON address (T-prefix, 34 chars)',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address to query multisig permissions for',
      required: true,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
  ],
  steps: [
    {
      tool: 'multisig_query_auth',
      input: { address: '{{address}}' },
      description:
        'Query multisig auth: returns permissions array with owner_address, ' +
        'owner_permission (threshold, keys with weight), and active_permissions',
    },
  ],
  tags: ['multisig', 'permissions', 'auth', 'query'],
};

/**
 * Flow recipe: List multisig transactions.
 *
 * Queries transaction list with optional filtering by state and signature status.
 * Shows signature progress, threshold, and current weight for each transaction.
 */
export const multisigListTransactionsFlow: FlowRecipe = {
  id: 'multisig_list_transactions',
  name: 'List Multisig Transactions',
  description:
    'List multisig transactions for an address. Filter by state (processing/success/failed) ' +
    'and signature status. Shows signature progress, threshold, current weight per transaction.',
  context: 'both',
  preconditions: [
    'MultiSig capability is configured',
    'Address has been involved in multisig transactions',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address to query transactions for',
      required: true,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
    {
      name: 'state',
      description:
        'Transaction state filter: 0=processing, 1=success, 2=failed, 255=all',
      required: false,
      default: '255',
      example: '0',
    },
    {
      name: 'limit',
      description: 'Number of transactions to return (max 100)',
      required: false,
      default: '20',
      example: '10',
    },
  ],
  steps: [
    {
      tool: 'multisig_list_tx',
      input: {
        address: '{{address}}',
        state: '{{state}}',
        limit: '{{limit}}',
      },
      description:
        'List multisig transactions: returns total count, transactions with hash, ' +
        'contractType, threshold, currentWeight, state, and signatureProgress array',
    },
  ],
  tags: ['multisig', 'transactions', 'list', 'pending', 'query'],
};

/**
 * Flow recipe: Monitor multisig transactions via WebSocket.
 *
 * Connects WebSocket for real-time notifications, then lists current pending
 * transactions. Use disconnect flow to stop monitoring.
 */
export const multisigMonitorFlow: FlowRecipe = {
  id: 'multisig_monitor',
  name: 'Monitor Multisig Transactions',
  description:
    'Connect WebSocket for real-time pending multisig transaction notifications, ' +
    'then list current pending transactions. Use multisig_stop_monitor to disconnect.',
  context: 'both',
  preconditions: [
    'MultiSig capability is configured',
    'Address is a valid TRON address',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address to monitor for pending multisig transactions',
      required: true,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
  ],
  steps: [
    {
      tool: 'multisig_connect_ws',
      input: { address: '{{address}}' },
      description: 'Connect WebSocket for real-time pending transaction notifications',
    },
    {
      tool: 'multisig_list_tx',
      input: { address: '{{address}}', state: 0, limit: 20 },
      description: 'List current pending (processing) transactions',
    },
  ],
  tags: ['multisig', 'monitor', 'websocket', 'realtime', 'pending'],
};

/**
 * Flow recipe: Stop monitoring multisig transactions.
 *
 * Disconnects the WebSocket listener established by multisig_monitor.
 */
export const multisigStopMonitorFlow: FlowRecipe = {
  id: 'multisig_stop_monitor',
  name: 'Stop Multisig Monitor',
  description: 'Disconnect the multisig WebSocket listener.',
  context: 'both',
  preconditions: ['WebSocket is currently connected via multisig_monitor'],
  params: [],
  steps: [
    {
      tool: 'multisig_disconnect_ws',
      input: {},
      description: 'Disconnect multisig WebSocket',
    },
  ],
  tags: ['multisig', 'monitor', 'websocket', 'disconnect', 'stop'],
};

/**
 * Flow recipe: Submit a signed multisig transaction.
 *
 * After signing a transaction in TronLink, submit the signed transaction data
 * to the multisig service. The service collects signatures from all parties
 * and broadcasts when the threshold is met.
 */
export const multisigSubmitTxFlow: FlowRecipe = {
  id: 'multisig_submit_tx',
  name: 'Submit Multisig Transaction',
  description:
    'Submit a signed multisig transaction to the service. The service collects signatures ' +
    'from all required parties and broadcasts when the threshold weight is met. ' +
    'Requires a pre-signed transaction object (raw_data + signature array).',
  context: 'both',
  preconditions: [
    'MultiSig capability is configured',
    'Transaction has been signed by the submitting address',
    'Transaction raw_data and signature are available',
  ],
  params: [
    {
      name: 'address',
      description: 'Signer address submitting this transaction',
      required: true,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
    {
      name: 'transaction',
      description:
        'Signed transaction object with raw_data (ref_block_bytes, ref_block_hash, ' +
        'expiration, contract array, timestamp, fee_limit) and signature array',
      required: true,
      example: '{"raw_data":{...},"signature":["hex..."]}',
    },
  ],
  steps: [
    {
      tool: 'multisig_submit_tx',
      input: {
        address: '{{address}}',
        transaction: '{{transaction}}',
      },
      description:
        'Submit signed transaction: returns success flag, code, message. ' +
        'code=0 means accepted, service will broadcast when threshold is met.',
    },
  ],
  tags: ['multisig', 'submit', 'sign', 'transaction', 'broadcast'],
};

/**
 * Flow recipe: Full multisig check workflow.
 *
 * Queries permissions for an address, then lists all its pending transactions
 * that need signatures. Useful as a starting point before signing.
 */
export const multisigCheckFlow: FlowRecipe = {
  id: 'multisig_check',
  name: 'Check Multisig Status',
  description:
    'Full multisig status check: query permissions for an address (thresholds, signers, weights), ' +
    'then list pending transactions that still need signatures. ' +
    'Use this before deciding which transactions to sign.',
  context: 'both',
  preconditions: [
    'MultiSig capability is configured',
    'Address is a valid TRON address',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address to check multisig status for',
      required: true,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
  ],
  steps: [
    {
      tool: 'multisig_query_auth',
      input: { address: '{{address}}' },
      description: 'Query multisig permissions: who controls this address, thresholds, weights',
    },
    {
      tool: 'multisig_list_tx',
      input: { address: '{{address}}', state: 0, limit: 20 },
      description: 'List pending transactions that still need signatures',
    },
    {
      tool: 'multisig_list_tx',
      input: { address: '{{address}}', state: 0, is_sign: false, limit: 10 },
      description: 'List pending transactions NOT yet signed by this address',
      optional: true,
    },
  ],
  tags: ['multisig', 'check', 'status', 'permissions', 'pending'],
};
