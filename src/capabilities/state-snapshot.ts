import type { Page } from 'playwright';
import type {
  StateSnapshotCapability,
  StateOptions,
  StateSnapshot,
} from '@tronlink/mcp-core';

/**
 * State snapshot capability for TronLink extension.
 * Detects the current screen and extracts wallet state from the UI.
 */
export class TronLinkStateSnapshotCapability implements StateSnapshotCapability {
  async getState(page: Page, _options?: StateOptions): Promise<StateSnapshot> {
    const url = page.url();
    const currentScreen = await this.detectCurrentScreen(page);

    const snapshot: StateSnapshot = {
      currentScreen,
      currentUrl: url,
      isUnlocked: false,
    };

    try {
      const state = await page.evaluate(() => {
        const root = document.getElementById('root');
        const isLoaded = !!(root && root.children.length > 0);
        const hasPasswordInput =
          document.querySelector('input[type="password"]') !== null;

        // Try to extract address
        let address = '';
        const addrElements = document.querySelectorAll(
          '[class*="address"], [class*="account"], [class*="addr"]',
        );
        for (const el of addrElements) {
          const text = el.textContent || '';
          const match = text.match(/T[A-Za-z1-9]{33}/);
          if (match) {
            address = match[0];
            break;
          }
        }

        // Try to extract balance
        let balance = '';
        const balanceElements = document.querySelectorAll(
          '[class*="balance"], [class*="amount"], [class*="trx"]',
        );
        for (const el of balanceElements) {
          const text = el.textContent || '';
          const match = text.match(/([\d,.]+)\s*TRX/i);
          if (match) {
            balance = match[1].replace(/,/g, '');
            break;
          }
        }

        // Try to extract network name
        let network = '';
        const networkElements = document.querySelectorAll(
          '[class*="network"], [class*="chain"]',
        );
        for (const el of networkElements) {
          const text = (el.textContent || '').trim();
          if (
            text &&
            (text.includes('Mainnet') ||
              text.includes('Nile') ||
              text.includes('Shasta') ||
              text.includes('Testnet'))
          ) {
            network = text;
            break;
          }
        }

        return {
          isLoaded,
          hasPasswordInput,
          address,
          balance,
          network,
        };
      });

      snapshot.isUnlocked =
        state.isLoaded && !state.hasPasswordInput;
      if (state.address) snapshot.accountAddress = state.address;
      if (state.balance) snapshot.balanceTrx = state.balance;
      if (state.network) snapshot.networkName = state.network;
    } catch {
      // Page not accessible
    }

    return snapshot;
  }

  async detectCurrentScreen(page: Page): Promise<string> {
    const url = page.url();

    if (url.includes('#/home')) return 'home';
    if (url.includes('#/login')) return 'login';
    if (url.includes('#/settings')) return 'settings';
    if (url.includes('#/transfer')) return 'send';
    if (url.includes('#/receive')) return 'receive';
    if (url.includes('#/sign')) return 'sign';
    if (url.includes('#/broadcast')) return 'broadcast';
    if (url.includes('#/assets_management')) return 'assets';
    if (url.includes('#/address_book')) return 'address_book';
    if (url.includes('#/node_management')) return 'node_management';
    if (url.includes('#/dapp_list')) return 'dapp_list';
    if (url.includes('#/create_wallet')) return 'create_wallet';
    if (url.includes('#/import_wallet')) return 'import_wallet';
    if (url.includes('#/export_account')) return 'export_account';
    if (url.includes('secondary_popup')) return 'notification';

    // Fallback: check for common UI patterns
    try {
      const hasPasswordInput = await page
        .locator('input[type="password"]')
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (hasPasswordInput) return 'login';
    } catch {
      // Ignore
    }

    return 'unknown';
  }
}
