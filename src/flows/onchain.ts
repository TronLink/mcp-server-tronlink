import type { FlowRecipe } from '@tronlink/tronlink-mcp-core';

export const chainCheckBalanceFlow: FlowRecipe = {
  id: 'chain_check_balance',
  name: 'Check Account Balance (On-chain)',
  description:
    'Query TRX balance, bandwidth, energy, and account activation status directly via TronGrid API.',
  context: 'both',
  preconditions: [
    'On-chain capability configured (agent-wallet + TL_TRONGRID_URL)',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address to query (omit for configured wallet)',
      required: false,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
  ],
  steps: [
    {
      tool: 'chain_get_account',
      input: { address: '{{address}}' },
      description: 'Query account balance, bandwidth, energy, and permissions',
    },
  ],
  tags: ['onchain', 'balance', 'query'],
};

export const chainTransferTrxFlow: FlowRecipe = {
  id: 'chain_transfer_trx',
  name: 'Transfer TRX (On-chain)',
  description:
    'Send TRX to an address directly via the configured private key. Pre-checks TRX balance before sending.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Sufficient TRX balance for transfer + bandwidth fee',
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
      description: 'TRX amount to send (e.g. "1.5")',
      required: true,
      example: '1.0',
    },
  ],
  steps: [
    {
      tool: 'chain_get_account',
      input: {},
      description: 'Pre-check: verify TRX balance is sufficient for transfer',
    },
    {
      tool: 'chain_send',
      input: { to: '{{to}}', amount: '{{amount}}', token_type: 'TRX' },
      description: 'Sign and broadcast TRX transfer',
    },
  ],
  tags: ['onchain', 'transfer', 'trx'],
};

export const chainTransferTrc20Flow: FlowRecipe = {
  id: 'chain_transfer_trc20',
  name: 'Transfer TRC20 Token (On-chain)',
  description:
    'Send TRC20 tokens to an address. Pre-checks token balance before sending.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Sufficient TRC20 token balance',
    'Sufficient TRX for energy/bandwidth fee',
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
      description: 'Token amount (in smallest unit)',
      required: true,
      example: '1000000',
    },
    {
      name: 'contract_address',
      description: 'TRC20 contract address',
      required: true,
      example: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
    },
  ],
  steps: [
    {
      tool: 'chain_get_tokens',
      input: {},
      description: 'Pre-check: verify TRC20 token balance',
    },
    {
      tool: 'chain_get_account',
      input: {},
      description: 'Pre-check: verify TRX balance for energy fee',
    },
    {
      tool: 'chain_send',
      input: {
        to: '{{to}}',
        amount: '{{amount}}',
        token_type: 'TRC20',
        contract_address: '{{contract_address}}',
      },
      description: 'Transfer TRC20 tokens via triggersmartcontract',
    },
  ],
  tags: ['onchain', 'transfer', 'trc20', 'token'],
};

export const chainStakeFlow: FlowRecipe = {
  id: 'chain_stake',
  name: 'Stake TRX (On-chain)',
  description:
    'Freeze TRX for bandwidth or energy via Stake 2.0. Pre-checks TRX balance.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Sufficient TRX balance',
  ],
  params: [
    {
      name: 'amount_trx',
      description: 'Amount of TRX to freeze',
      required: true,
      example: '10',
    },
    {
      name: 'resource',
      description: 'Resource type: BANDWIDTH or ENERGY',
      required: false,
      example: 'BANDWIDTH',
    },
  ],
  steps: [
    {
      tool: 'chain_get_account',
      input: {},
      description: 'Pre-check: verify TRX balance is sufficient for staking',
    },
    {
      tool: 'chain_stake',
      input: { action: 'freeze', amount_trx: '{{amount_trx}}', resource: '{{resource}}' },
      description: 'Freeze TRX for resources',
    },
  ],
  tags: ['onchain', 'stake', 'freeze'],
};

export const chainUnstakeFlow: FlowRecipe = {
  id: 'chain_unstake',
  name: 'Unstake TRX (On-chain)',
  description:
    'Unfreeze TRX from Stake 2.0. Pre-checks that sufficient TRX is frozen.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Frozen TRX available for the specified resource',
  ],
  params: [
    {
      name: 'amount_trx',
      description: 'Amount of TRX to unfreeze',
      required: true,
      example: '10',
    },
    {
      name: 'resource',
      description: 'Resource type: BANDWIDTH or ENERGY',
      required: false,
      example: 'BANDWIDTH',
    },
  ],
  steps: [
    {
      tool: 'chain_get_staking',
      input: {},
      description: 'Pre-check: verify frozen TRX is sufficient for unstaking',
    },
    {
      tool: 'chain_stake',
      input: { action: 'unfreeze', amount_trx: '{{amount_trx}}', resource: '{{resource}}' },
      description: 'Unfreeze TRX to release resources',
    },
  ],
  tags: ['onchain', 'unstake', 'unfreeze'],
};

export const chainGetStakingFlow: FlowRecipe = {
  id: 'chain_get_staking',
  name: 'Query Staking Info (On-chain)',
  description:
    'Query TRX staking details: frozen amounts, votes, pending unfreezing, withdrawable amounts.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
  ],
  params: [
    {
      name: 'address',
      description: 'TRON address (omit for configured wallet)',
      required: false,
      example: 'TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF',
    },
  ],
  steps: [
    {
      tool: 'chain_get_staking',
      input: { address: '{{address}}' },
      description: 'Query staking info',
    },
  ],
  tags: ['onchain', 'staking', 'query'],
};

export const chainDelegateResourceFlow: FlowRecipe = {
  id: 'chain_delegate_resource',
  name: 'Delegate Resource (On-chain)',
  description:
    'Delegate bandwidth or energy to another address. Pre-checks that frozen resources are available.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Frozen TRX available for delegation',
  ],
  params: [
    {
      name: 'receiver',
      description: 'Receiver address for delegation',
      required: true,
      example: 'TRfkpf6M4qFkeqANrgaC6TdGD6Ry4cveiy',
    },
    {
      name: 'amount_trx',
      description: 'Amount of TRX resource to delegate',
      required: true,
      example: '5',
    },
    {
      name: 'resource',
      description: 'Resource type: BANDWIDTH or ENERGY',
      required: false,
      example: 'BANDWIDTH',
    },
  ],
  steps: [
    {
      tool: 'chain_get_staking',
      input: {},
      description: 'Pre-check: verify frozen resources available for delegation',
    },
    {
      tool: 'chain_resource',
      input: {
        action: 'delegate',
        receiver: '{{receiver}}',
        amount_trx: '{{amount_trx}}',
        resource: '{{resource}}',
      },
      description: 'Delegate resource to receiver',
    },
  ],
  tags: ['onchain', 'delegate', 'resource'],
};

export const chainUndelegateResourceFlow: FlowRecipe = {
  id: 'chain_undelegate_resource',
  name: 'Undelegate Resource (On-chain)',
  description:
    'Reclaim delegated bandwidth or energy. Pre-checks that active delegations exist.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Active delegations exist for the resource',
  ],
  params: [
    {
      name: 'receiver',
      description: 'Address to undelegate from',
      required: true,
      example: 'TRfkpf6M4qFkeqANrgaC6TdGD6Ry4cveiy',
    },
    {
      name: 'amount_trx',
      description: 'Amount of TRX resource to reclaim',
      required: true,
      example: '5',
    },
    {
      name: 'resource',
      description: 'Resource type: BANDWIDTH or ENERGY',
      required: false,
      example: 'BANDWIDTH',
    },
  ],
  steps: [
    {
      tool: 'chain_resource',
      input: { action: 'query' },
      description: 'Pre-check: verify active delegations exist to undelegate',
    },
    {
      tool: 'chain_resource',
      input: {
        action: 'undelegate',
        receiver: '{{receiver}}',
        amount_trx: '{{amount_trx}}',
        resource: '{{resource}}',
      },
      description: 'Reclaim delegated resource',
    },
  ],
  tags: ['onchain', 'undelegate', 'resource'],
};

export const chainSetupMultisigFlow: FlowRecipe = {
  id: 'chain_setup_multisig',
  name: 'Setup Multisig (On-chain)',
  description:
    'Configure multisig permissions on the account. Pre-checks TRX balance (100 TRX fee) and current permissions.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'At least 100 TRX for permission update fee',
  ],
  params: [
    {
      name: 'cosigner_address',
      description: 'Co-signer TRON address',
      required: true,
      example: 'TRfkpf6M4qFkeqANrgaC6TdGD6Ry4cveiy',
    },
    {
      name: 'threshold',
      description: 'Signature weight threshold (e.g. 2 for 2-of-2)',
      required: true,
      example: '2',
    },
  ],
  steps: [
    {
      tool: 'chain_get_account',
      input: {},
      description: 'Pre-check: verify TRX balance (need 100 TRX) and current permissions',
    },
    {
      tool: 'chain_setup_multisig',
      input: {
        cosigner_addresses: ['{{cosigner_address}}'],
        threshold: '{{threshold}}',
      },
      description: 'Update account permissions to add cosigner',
    },
  ],
  tags: ['onchain', 'multisig', 'setup', 'permissions'],
};

export const chainCreateMultisigTxFlow: FlowRecipe = {
  id: 'chain_create_multisig_tx',
  name: 'Create Multisig Transaction (On-chain)',
  description:
    'Create an unsigned multisig TRX transfer. Pre-checks multisig permissions exist.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'Multisig permissions already configured on account',
  ],
  params: [
    {
      name: 'to',
      description: 'Recipient TRON address',
      required: true,
      example: 'TRfkpf6M4qFkeqANrgaC6TdGD6Ry4cveiy',
    },
    {
      name: 'amount_sun',
      description: 'Amount in SUN (1 TRX = 1,000,000 SUN)',
      required: true,
      example: '1000000',
    },
  ],
  steps: [
    {
      tool: 'chain_get_account',
      input: {},
      description: 'Pre-check: verify multisig permissions and TRX balance',
    },
    {
      tool: 'chain_create_multisig_tx',
      input: {
        to: '{{to}}',
        amount_sun: '{{amount_sun}}',
      },
      description: 'Create unsigned multisig transaction',
    },
  ],
  tags: ['onchain', 'multisig', 'create', 'transaction'],
};

export const chainSwapV3Flow: FlowRecipe = {
  id: 'chain_swap_v3',
  name: 'SunSwap V3 Swap (On-chain)',
  description:
    'Estimate or execute a token swap via SunSwap V3 (concentrated liquidity). Pre-checks balance.',
  context: 'both',
  preconditions: [
    'On-chain capability configured',
    'SunSwap V3 router configured (TL_SUNSWAP_V3_ROUTER)',
  ],
  params: [
    {
      name: 'from_token',
      description: 'Source token address or "TRX"',
      required: true,
      example: 'TRX',
    },
    {
      name: 'to_token',
      description: 'Target token address or "TRX"',
      required: true,
      example: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
    },
    {
      name: 'amount',
      description: 'Input amount',
      required: true,
      example: '1000000',
    },
    {
      name: 'fee_tier',
      description: 'Pool fee tier in bps (500, 3000, 10000)',
      required: false,
      example: '3000',
    },
  ],
  steps: [
    {
      tool: 'chain_get_account',
      input: {},
      description: 'Pre-check: verify balance for swap',
    },
    {
      tool: 'chain_swap_v3',
      input: {
        action: 'estimate',
        from_token: '{{from_token}}',
        to_token: '{{to_token}}',
        amount: '{{amount}}',
        fee_tier: '{{fee_tier}}',
      },
      description: 'Estimate swap output',
    },
    {
      tool: 'chain_swap_v3',
      input: {
        action: 'execute',
        from_token: '{{from_token}}',
        to_token: '{{to_token}}',
        amount: '{{amount}}',
        fee_tier: '{{fee_tier}}',
      },
      description: 'Execute SunSwap V3 swap',
    },
  ],
  tags: ['onchain', 'swap', 'sunswap', 'v3', 'dex'],
};
