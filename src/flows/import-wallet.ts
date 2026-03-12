import type { FlowRecipe } from '@tronlink/mcp-core';

/**
 * Flow recipe: Import a wallet using a private key on the TronLink guide/onboarding screen.
 *
 * Covers: agreement acceptance → key entry → wallet naming → password setup → network
 * selection → import confirmation.
 *
 * Tested on TronLink v4.7.5 (prod mode, Nile Testnet).
 */
export const importWalletFlow: FlowRecipe = {
  id: 'import_wallet',
  name: 'Import Wallet via Private Key',
  description:
    'Import a TRON wallet using a private key when TronLink is on the guide/onboarding screen. ' +
    'Steps: accept user agreement → enter private key → set wallet name & password → select TRON network → confirm import.',
  context: 'prod',
  preconditions: [
    'Browser launched via tl_launch (no fixture or fixture="onboarding")',
    'Extension is on the guide/onboarding screen (#/guide)',
    'A valid TRON private key (64-char hex) is available',
  ],
  params: [
    {
      name: 'privateKey',
      description: 'TRON private key (64-character hex string)',
      required: true,
      example: '0123456789abcdef...',
    },
    {
      name: 'walletName',
      description: 'Display name for the imported wallet',
      required: false,
      default: 'MyWallet',
      example: 'MyWallet',
    },
    {
      name: 'password',
      description:
        'Wallet password (≥8 chars, must include uppercase, lowercase, and number)',
      required: true,
      example: 'TronLink2024!',
    },
  ],
  steps: [
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Import Wallet' && e.children.length <= 1); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description:
        'Click "Import Wallet" button on guide page',
    },
    {
      tool: 'scroll',
      input: {
        selector: 'div[class*="scroll"]',
        direction: 'down',
        amount: 10000,
      },
      description: 'Scroll user agreement to bottom',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'I agree, no more reminders' && e.children.length <= 1); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description: 'Click "I agree, no more reminders"',
    },
    {
      tool: 'type',
      input: {
        selector: 'textarea.ant-input',
        text: '{{privateKey}}',
      },
      description: 'Enter private key in the input area',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Next' && (e.tagName === 'BUTTON' || e.tagName === 'DIV') && e.children.length <= 1); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description: 'Click "Next" to proceed to wallet setup',
    },
    {
      tool: 'type',
      input: {
        selector: 'input[placeholder="Import"]',
        text: '{{walletName}}',
      },
      description: 'Set wallet name',
    },
    {
      tool: 'type',
      input: {
        selector: 'input[placeholder="Enter a password"]',
        text: '{{password}}',
      },
      description: 'Enter password',
    },
    {
      tool: 'type',
      input: {
        selector: 'input[placeholder="Enter the password again"]',
        text: '{{password}}',
      },
      description: 'Confirm password',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Next' && (e.tagName === 'BUTTON' || e.tagName === 'DIV') && e.children.length <= 1); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description: 'Click "Next" to show network selection',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Import Private Key' && e.tagName === 'BUTTON'); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description:
        'Click "Import Private Key" to complete import (TRON selected by default)',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "new Promise(r => setTimeout(r, 2000)).then(() => { const text = document.querySelector('#root')?.innerText || ''; if (text.includes('Version Updated') || text.includes('Got It')) { const all = Array.from(document.querySelectorAll('button')); const btn = all.find(e => e.textContent.trim() === 'Got It'); if (btn) btn.click(); } return window.location.hash; })",
      },
      description:
        'Wait for import to complete and dismiss version update popup if shown',
    },
  ],
  tags: ['wallet', 'onboarding', 'import', 'setup', 'private-key'],
};
