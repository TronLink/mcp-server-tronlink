import type { FlowRecipe } from '@tronlink/mcp-core';

/**
 * Flow recipe: Switch TronLink to a different TRON network.
 *
 * Uses the network selector dropdown on the home page header.
 * To see test networks (Nile, Shasta), "Show Test Networks" must be enabled
 * in Settings → Networks first.
 *
 * Tested on TronLink v4.7.5.
 */
export const switchNetworkFlow: FlowRecipe = {
  id: 'switch_network',
  name: 'Switch Network',
  description:
    'Switch TronLink to a different TRON network. Opens the network selector from the home page ' +
    'and selects the target network. For test networks (Nile/Shasta), enable "Show Test Networks" ' +
    'in Settings → Networks first.',
  context: 'both',
  preconditions: [
    'Wallet is unlocked and imported',
    'For test networks: "Show Test Networks" is enabled in Settings → Networks',
  ],
  params: [
    {
      name: 'networkName',
      description:
        'Target network display name. Common values: "TRON Mainnet (TronGrid)", "TRON Nile Testnet", "TRON Shasta Testnet"',
      required: true,
      example: 'TRON Nile Testnet',
    },
  ],
  steps: [
    {
      tool: 'navigate',
      input: { target: 'home' },
      description: 'Navigate to home page',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const el = document.querySelector('div.sRlc9DB6WxWEc__c2Yag'); if (el) { el.click(); 'clicked network selector'; } else { 'not found'; }",
      },
      description:
        'Click network selector icon in the header bar',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "new Promise(r => setTimeout(r, 500)).then(() => { const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === '{{networkName}}' && e.children.length === 0); if (el) { el.click(); 'selected {{networkName}}'; } else { 'not found: ' + document.querySelector('#root')?.innerText?.substring(0, 500); } })",
      },
      description:
        'Wait for network list to render, then select target network',
    },
  ],
  tags: ['network', 'settings', 'switch', 'nile', 'shasta', 'mainnet'],
};

/**
 * Flow recipe: Enable test networks visibility.
 *
 * Required before switching to Nile or Shasta test networks.
 */
export const enableTestNetworksFlow: FlowRecipe = {
  id: 'enable_test_networks',
  name: 'Enable Test Networks',
  description:
    'Enable "Show Test Networks" toggle in Settings → Networks to make Nile/Shasta test networks visible.',
  context: 'both',
  preconditions: ['Wallet is unlocked and imported'],
  params: [],
  steps: [
    {
      tool: 'navigate',
      input: { target: 'settings' },
      description: 'Navigate to settings page',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Networks' && e.children.length === 0); if (el) { el.click(); 'clicked'; } else { 'not found'; }",
      },
      description: 'Click "Networks" option',
    },
    {
      tool: 'evaluate',
      input: {
        script:
          "const all = Array.from(document.querySelectorAll('*')); const el = all.find(e => e.textContent.trim() === 'Show Test Networks' && e.children.length === 0); if (el) { const parent = el.parentElement; const sw = parent.querySelector('[class*=\"switch\"], [class*=\"toggle\"], [role=\"switch\"], button'); if (sw) { sw.click(); 'clicked switch'; } else { parent.click(); 'clicked parent'; } } else { 'not found'; }",
      },
      description: 'Toggle "Show Test Networks" switch on',
    },
  ],
  tags: ['network', 'settings', 'testnet', 'nile', 'shasta'],
};
