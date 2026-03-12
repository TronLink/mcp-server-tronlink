import type { FlowRecipe } from '@tronlink/mcp-core';

/**
 * Flow recipe: Transfer TRX to a recipient address.
 *
 * Navigates through the multi-step send flow:
 *   step 1 → enter recipient address
 *   step 2 → enter amount & send
 *   confirm → sign transaction
 *   broadcast → verify success
 *
 * Tested on TronLink v4.7.5 (Nile Testnet).
 */
export const transferTrxFlow: FlowRecipe = {
  id: 'transfer_trx',
  name: 'Transfer TRX',
  description:
    'Send TRX to a recipient address. Goes through: enter address → enter amount → confirm → sign → verify broadcast.',
  context: 'both',
  preconditions: [
    'Wallet is unlocked with sufficient TRX balance',
    'Recipient is a valid TRON address (T-prefix, 34 chars)',
    'Wallet has enough bandwidth or TRX for transaction fee',
  ],
  params: [
    {
      name: 'recipientAddress',
      description: 'TRON address to send TRX to (T-prefix, 34 characters)',
      required: true,
      example: 'TKvSbBGaHUy8npTTSr2R9GQLLXEeGZ5y54',
    },
    {
      name: 'amount',
      description: 'Amount of TRX to send',
      required: true,
      example: '2',
    },
  ],
  steps: [
    {
      tool: 'navigate',
      input: { target: 'send' },
      description: 'Navigate to send page (step 1/2)',
    },
    {
      tool: 'type',
      input: {
        selector: 'textarea[placeholder="Paste or enter the account address"]',
        text: '{{recipientAddress}}',
      },
      description: 'Enter recipient address',
    },
    {
      tool: 'click',
      input: { selector: 'button.B1a7cASr1kJ_GaXOoFFL', force: true },
      description:
        'Click "Next" button (force: button at y=660 may be below viewport)',
    },
    {
      tool: 'wait_for',
      input: {
        selector: 'input[placeholder="0"]',
        state: 'visible',
        timeout: 5000,
      },
      description: 'Wait for step 2 amount input to appear',
    },
    {
      tool: 'type',
      input: { selector: 'input[placeholder="0"]', text: '{{amount}}' },
      description: 'Enter TRX amount',
    },
    {
      tool: 'click',
      input: {
        selector: 'button.B1a7cASr1kJ_GaXOoFFL.is-valid',
        force: true,
      },
      description:
        'Click "Send" button (has .is-valid class when form is valid)',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "new Promise(r => setTimeout(r, 1000)).then(() => { const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Sign' && e.children.length <= 1); if (el) { el.click(); 'signed'; } else { 'Sign not found: ' + document.querySelector('#root')?.innerText?.substring(0, 200); } })",
      },
      description:
        'Wait 1s for confirm page, then click "Sign" to sign & broadcast',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "new Promise(r => setTimeout(r, 2000)).then(() => { const text = document.querySelector('#root')?.innerText || ''; if (text.includes('Transaction has been broadcast')) { 'success'; } else if (text.includes('Transaction Details')) { 'success - on details page'; } else { 'current page: ' + text.substring(0, 200); } })",
      },
      description:
        'Wait 2s then verify transaction was broadcast successfully',
    },
  ],
  tags: ['transfer', 'trx', 'send', 'transaction'],
};

/**
 * Flow recipe: Transfer TRC20 token (e.g., USDT).
 *
 * Similar to TRX transfer but requires selecting the token first.
 */
export const transferTokenFlow: FlowRecipe = {
  id: 'transfer_token',
  name: 'Transfer TRC20 Token',
  description:
    'Send a TRC20 token (e.g., USDT) to a recipient address. Same flow as TRX transfer ' +
    'but selects a specific token on step 2.',
  context: 'both',
  preconditions: [
    'Wallet is unlocked with the token in asset list',
    'Sufficient token balance and TRX for energy/bandwidth fees',
  ],
  params: [
    {
      name: 'recipientAddress',
      description: 'TRON address to send tokens to',
      required: true,
      example: 'TKvSbBGaHUy8npTTSr2R9GQLLXEeGZ5y54',
    },
    {
      name: 'amount',
      description: 'Amount of tokens to send',
      required: true,
      example: '10',
    },
    {
      name: 'tokenName',
      description: 'Token name to select (e.g. "USDT", "USDD")',
      required: true,
      example: 'USDT',
    },
  ],
  steps: [
    {
      tool: 'navigate',
      input: { target: 'send' },
      description: 'Navigate to send page',
    },
    {
      tool: 'type',
      input: {
        selector: 'textarea[placeholder="Paste or enter the account address"]',
        text: '{{recipientAddress}}',
      },
      description: 'Enter recipient address',
    },
    {
      tool: 'click',
      input: { selector: 'button.B1a7cASr1kJ_GaXOoFFL', force: true },
      description: 'Click "Next" to go to step 2',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const tokenEl = all.find(e => e.textContent.trim() === 'TRX' && e.children.length <= 1 && e.tagName !== 'P'); if (tokenEl) { tokenEl.click(); 'clicked token selector'; } else { 'not found'; }",
      },
      description: 'Click token selector (shows TRX by default)',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === '{{tokenName}}' && e.children.length <= 1); if (el) { el.click(); 'selected {{tokenName}}'; } else { 'not found'; }",
      },
      description: 'Select target token from the list',
    },
    {
      tool: 'type',
      input: { selector: 'input[placeholder="0"]', text: '{{amount}}' },
      description: 'Enter token amount',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('button')); const el = all.find(e => e.textContent.trim() === 'Send'); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description: 'Click "Send"',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Sign' && e.children.length <= 1); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description: 'Click "Sign" on confirmation page',
    },
    {
      tool: 'wait_for',
      input: {
        selector: 'text=Transaction has been broadcast',
        state: 'visible',
        timeout: 30000,
      },
      description: 'Wait for broadcast success',
      optional: true,
    },
  ],
  tags: ['transfer', 'token', 'trc20', 'usdt', 'send', 'transaction'],
};
