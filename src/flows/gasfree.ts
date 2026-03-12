import type { FlowRecipe } from '@tronlink/mcp-core';

export const gasfreeCheckAccountFlow: FlowRecipe = {
  id: 'gasfree_check_account',
  name: 'Check GasFree Account',
  description:
    'Query GasFree eligibility, supported tokens, and daily quota for gas-free TRC20 transfers.',
  context: 'both',
  preconditions: [
    'GasFree capability configured (TL_GASFREE_BASE_URL)',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address to check (omit for configured wallet)',
      required: false,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
  ],
  steps: [
    {
      tool: 'gasfree_get_account',
      input: { address: '{{address}}' },
      description: 'Query GasFree account eligibility and supported tokens',
    },
  ],
  tags: ['gasfree', 'query', 'account'],
};

export const gasfreeTransactionHistoryFlow: FlowRecipe = {
  id: 'gasfree_transaction_history',
  name: 'GasFree Transaction History',
  description:
    'Query history of gas-free TRC20 transfers.',
  context: 'both',
  preconditions: [
    'GasFree capability configured',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address (omit for configured wallet)',
      required: false,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
    {
      name: 'status',
      description: 'Filter: pending, success, failed, all',
      required: false,
      example: 'all',
    },
  ],
  steps: [
    {
      tool: 'gasfree_get_transactions',
      input: { address: '{{address}}', status: '{{status}}' },
      description: 'Query GasFree transaction history',
    },
  ],
  tags: ['gasfree', 'query', 'transactions'],
};

export const gasfreeSendFlow: FlowRecipe = {
  id: 'gasfree_send',
  name: 'GasFree TRC20 Transfer',
  description:
    'Send TRC20 tokens without paying gas fee. Pre-checks: eligibility, token support, quota, and token balance.',
  context: 'both',
  preconditions: [
    'GasFree capability configured',
    'Account eligible for GasFree',
    'Sufficient TRC20 token balance',
  ],
  params: [
    {
      name: 'to',
      description: 'Recipient TRON address',
      required: true,
      example: 'TRfkpf6M4qFkeqANrgaC6TdGD6Ry4cveiy',
    },
    {
      name: 'amount',
      description: 'Token amount to send',
      required: true,
      example: '10',
    },
    {
      name: 'contract_address',
      description: 'TRC20 token contract address',
      required: true,
      example: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
    },
  ],
  steps: [
    {
      tool: 'gasfree_get_account',
      input: {},
      description: 'Check GasFree eligibility and quota before sending',
    },
    {
      tool: 'chain_get_tokens',
      input: {},
      description: 'Verify token balance is sufficient',
    },
    {
      tool: 'gasfree_send',
      input: {
        to: '{{to}}',
        amount: '{{amount}}',
        contract_address: '{{contract_address}}',
      },
      description: 'Submit GasFree TRC20 transfer',
    },
  ],
  tags: ['gasfree', 'transfer', 'trc20'],
};
