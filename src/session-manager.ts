import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type {
  ISessionManager,
  SessionState,
  SessionMetadata,
  SessionLaunchInput,
  SessionLaunchResult,
  SessionScreenshotOptions,
  ScreenshotResult,
  TabRole,
  TrackedPage,
  EnvironmentMode,
  StateSnapshot,
  BuildCapability,
  FixtureCapability,
  ChainCapability,
  ContractSeedingCapability,
  StateSnapshotCapability,
  MockServerCapability,
  MultiSigCapability,
  OnChainCapability,
  GasFreeCapability,
} from '@tronlink/mcp-core';
import {
  generateSessionId,
  SCREENSHOT_DIR,
  TRONLINK_URLS,
} from '@tronlink/mcp-core';
import {
  resolveExtensionId,
  waitForExtensionReady,
} from '@tronlink/mcp-core';

export interface TronLinkSessionManagerConfig {
  extensionPath: string;
  mode?: EnvironmentMode;
  headless?: boolean;
  slowMo?: number;
  browserArgs?: string[];
  capabilities?: {
    build?: BuildCapability;
    fixture?: FixtureCapability;
    chain?: ChainCapability;
    contractSeeding?: ContractSeedingCapability;
    stateSnapshot?: StateSnapshotCapability;
    mockServer?: MockServerCapability;
    multiSig?: MultiSigCapability;
    onChain?: OnChainCapability;
    gasFree?: GasFreeCapability;
  };
}

/**
 * TronLink session manager implementation.
 * Manages browser lifecycle, page tracking, and extension interaction.
 */
/** Info about the last browser dialog that was auto-handled. */
export interface DialogRecord {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  url: string;
  timestamp: string;
  action: 'accepted' | 'dismissed';
}

export class TronLinkSessionManager implements ISessionManager {
  private config: TronLinkSessionManagerConfig;
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private activePage: Page | undefined;
  private sessionId: string | undefined;
  private extensionId: string | undefined;
  private sessionState: SessionState | undefined;
  private sessionMetadata: SessionMetadata | undefined;
  private refMap: Map<string, string> = new Map();
  private mode: EnvironmentMode;
  private userDataDir: string | undefined;
  /** Recent browser dialogs that were auto-handled (kept last 20). */
  private dialogHistory: DialogRecord[] = [];

  constructor(config: TronLinkSessionManagerConfig) {
    this.config = config;
    this.mode = config.mode || 'prod';
  }

  // ── Session lifecycle ──────────────────────────────

  hasActiveSession(): boolean {
    return !!(this.context && this.activePage);
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getSessionState(): SessionState | undefined {
    return this.sessionState;
  }

  getSessionMetadata(): SessionMetadata | undefined {
    return this.sessionMetadata;
  }

  async launch(input: SessionLaunchInput): Promise<SessionLaunchResult> {
    if (this.hasActiveSession()) {
      throw new Error('Session already running');
    }

    const extensionPath =
      input.extensionPath || this.config.extensionPath;

    if (!fs.existsSync(extensionPath)) {
      throw new Error(`Extension path does not exist: ${extensionPath}`);
    }

    // Start chain if requested
    if (input.startChain) {
      const chainCap = this.config.capabilities?.chain;
      if (chainCap && !chainCap.isRunning()) {
        await chainCap.start();
      }
    }

    // Start fixture server if needed
    if (input.fixture) {
      const fixtureCap = this.config.capabilities?.fixture;
      if (fixtureCap) {
        const state =
          input.fixture === 'default'
            ? fixtureCap.getDefaultState()
            : input.fixture === 'onboarding'
              ? fixtureCap.getOnboardingState()
              : fixtureCap.resolvePreset(input.fixture);
        await fixtureCap.start(
          input.fixtureData ? { ...state, data: input.fixtureData } : state,
        );
      }
    }

    // Launch browser with TronLink extension using persistent context
    // (extensions only work with launchPersistentContext in Playwright)
    const headless = input.headless ?? this.config.headless ?? false;

    const launchArgs = [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
      '--disable-popup-blocking',
      ...(this.config.browserArgs || []),
    ];

    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-mcp-'));

    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless,
      args: launchArgs,
      slowMo: this.config.slowMo,
    });

    // Auto-handle browser dialogs (alert/confirm/prompt/beforeunload)
    // to prevent them from blocking Playwright operations.
    this.installContextDialogHandler(this.context);

    // Generate session ID
    this.sessionId = generateSessionId();

    // Resolve extension ID
    this.extensionId = await resolveExtensionId(this.context);

    // Navigate to extension popup
    const page =
      this.context.pages()[0] || (await this.context.newPage());
    this.activePage = page;

    // Wait for extension to be ready
    await waitForExtensionReady(page, this.extensionId);

    // Update session state
    this.sessionState = {
      sessionId: this.sessionId,
      isActive: true,
      startedAt: new Date().toISOString(),
      extensionId: this.extensionId,
      environment: this.mode,
      browserConnected: true,
    };

    this.sessionMetadata = {
      schemaVersion: 1,
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
      flowTags: [],
      tags: [],
    };

    const chainCap = this.config.capabilities?.chain;

    return {
      sessionId: this.sessionId,
      extensionId: this.extensionId,
      extensionUrl: `chrome-extension://${this.extensionId}/popup/popup.html#/home`,
      chainRunning: chainCap?.isRunning() || false,
    };
  }

  async cleanup(): Promise<boolean> {
    try {
      // Stop capabilities
      if (this.config.capabilities?.fixture) {
        try {
          await this.config.capabilities.fixture.stop();
        } catch { /* best effort */ }
      }
      if (this.config.capabilities?.chain?.isRunning()) {
        try {
          await this.config.capabilities.chain.stop();
        } catch { /* best effort */ }
      }
      if (this.config.capabilities?.mockServer?.isRunning()) {
        try {
          await this.config.capabilities.mockServer.stop();
        } catch { /* best effort */ }
      }

      // Close browser context (persistent context manages the browser)
      if (this.context) {
        await this.context.close();
      } else if (this.browser) {
        await this.browser.close();
      }

      // Clean up temp user data directory
      if (this.userDataDir) {
        try {
          fs.rmSync(this.userDataDir, { recursive: true, force: true });
        } catch { /* best effort */ }
      }

      // Reset state
      this.browser = undefined;
      this.context = undefined;
      this.activePage = undefined;
      this.sessionId = undefined;
      this.extensionId = undefined;
      this.sessionState = undefined;
      this.userDataDir = undefined;
      this.refMap.clear();
      this.dialogHistory = [];

      return true;
    } catch {
      return false;
    }
  }

  // ── Page management ────────────────────────────────

  getPage(): Page {
    if (!this.activePage) {
      throw new Error('No active page. Call tl_launch first.');
    }
    return this.activePage;
  }

  setActivePage(page: Page): void {
    this.activePage = page;
  }

  getTrackedPages(): TrackedPage[] {
    if (!this.context) return [];

    return this.context.pages().map((page) => ({
      page,
      role: this.classifyPageRole(page),
      url: page.url(),
    }));
  }

  classifyPageRole(page: Page, extId?: string): TabRole {
    const url = page.url();
    const extensionId = extId || this.extensionId;

    if (!extensionId) return 'other';

    if (url.includes(`chrome-extension://${extensionId}`)) {
      if (
        url.includes('secondary_popup') ||
        url.includes('notification')
      ) {
        return 'notification';
      }
      return 'extension';
    }

    if (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('file://')
    ) {
      return 'dapp';
    }

    return 'other';
  }

  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error('No browser context. Call tl_launch first.');
    }
    return this.context;
  }

  // ── Extension state ────────────────────────────────

  async getExtensionState(): Promise<StateSnapshot> {
    const page = this.getPage();
    const url = page.url();

    // Try to extract state from the page
    const stateSnapshot: StateSnapshot = {
      currentScreen: this.detectScreenFromUrl(url),
      currentUrl: url,
      isUnlocked: false,
    };

    try {
      // Check if extension is loaded and get basic state from page
      const pageState = await page.evaluate(() => {
        // Try to read state from the DOM or window object
        const root = document.getElementById('root');
        const isLoaded = !!(root && root.children.length > 0);

        // Detect if on login screen by checking for password inputs
        const hasPasswordInput =
          document.querySelector('input[type="password"]') !== null;

        // Try to get address from the page (TronLink often shows it)
        const addressEl = document.querySelector(
          '[class*="address"], [class*="account"]',
        );
        const addressText = addressEl?.textContent?.trim() || '';

        // Try to detect balance text
        const balanceEl = document.querySelector(
          '[class*="balance"], [class*="amount"]',
        );
        const balanceText = balanceEl?.textContent?.trim() || '';

        return {
          isLoaded,
          hasPasswordInput,
          addressText,
          balanceText,
          title: document.title,
        };
      });

      stateSnapshot.isUnlocked =
        pageState.isLoaded && !pageState.hasPasswordInput;

      // Extract TRON address (T-prefix, 34 chars)
      const tronAddrMatch = pageState.addressText.match(/T[A-Za-z1-9]{33}/);
      if (tronAddrMatch) {
        stateSnapshot.accountAddress = tronAddrMatch[0];
      }

      // Extract balance
      const balanceMatch = pageState.balanceText.match(
        /[\d,.]+\s*(?:TRX|trx)/,
      );
      if (balanceMatch) {
        stateSnapshot.balanceTrx = balanceMatch[0]
          .replace(/[,\s]|TRX|trx/g, '')
          .trim();
      }
    } catch {
      // Page might not be accessible
    }

    return stateSnapshot;
  }

  // ── Accessibility references ───────────────────────

  setRefMap(map: Map<string, string>): void {
    this.refMap = map;
  }

  getRefMap(): Map<string, string> {
    return this.refMap;
  }

  clearRefMap(): void {
    this.refMap.clear();
  }

  resolveA11yRef(ref: string): string | undefined {
    return this.refMap.get(ref);
  }

  // ── Navigation ─────────────────────────────────────

  async navigateToHome(): Promise<void> {
    const page = this.getPage();
    const baseUrl = this.getExtensionBaseUrl();
    await page.goto(`${baseUrl}${TRONLINK_URLS.POPUP_HOME}`);
    await page.waitForLoadState('domcontentloaded');
  }

  async navigateToSettings(): Promise<void> {
    const page = this.getPage();
    const baseUrl = this.getExtensionBaseUrl();
    await page.goto(`${baseUrl}${TRONLINK_URLS.POPUP_SETTINGS}`);
    await page.waitForLoadState('domcontentloaded');
  }

  async navigateToUrl(url: string): Promise<Page> {
    // For extension URLs, reuse the current page to avoid page accumulation
    if (this.extensionId && url.includes(`chrome-extension://${this.extensionId}`)) {
      const page = this.getPage();
      await page.goto(url);
      await page.waitForLoadState('domcontentloaded');
      return page;
    }

    // For external URLs (dApps), check if there's an existing dapp page to reuse
    const existingPages = this.getTrackedPages();
    const dappPage = existingPages.find(
      (p) => p.role === 'dapp' && !p.url.startsWith('chrome-extension://'),
    );
    if (dappPage) {
      await dappPage.page.goto(url);
      this.activePage = dappPage.page;
      return dappPage.page;
    }

    // Create new page for new dApp navigation
    const page = await this.context!.newPage();
    await page.goto(url);
    this.activePage = page;
    return page;
  }

  async navigateToNotification(): Promise<Page> {
    // Look for existing notification page
    const pages = this.context!.pages();
    for (const p of pages) {
      if (
        p.url().includes('secondary_popup') ||
        p.url().includes('notification')
      ) {
        this.activePage = p;
        await p.bringToFront();
        return p;
      }
    }

    // Navigate to the secondary popup
    const page = await this.context!.newPage();
    const baseUrl = `chrome-extension://${this.extensionId}`;
    await page.goto(`${baseUrl}/secondary_popup/secondary_popup.html`);
    this.activePage = page;
    return page;
  }

  async waitForNotificationPage(timeoutMs: number): Promise<Page> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const pages = this.context!.pages();
      for (const p of pages) {
        const url = p.url();
        if (
          url.includes('secondary_popup') ||
          url.includes('notification')
        ) {
          this.activePage = p;
          await p.bringToFront();
          return p;
        }
      }

      // Listen for new pages
      try {
        const remaining = timeoutMs - (Date.now() - startTime);
        if (remaining <= 0) break;

        const newPage = await Promise.race([
          this.context!.waitForEvent('page', {
            timeout: Math.min(remaining, 2000),
          }),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), Math.min(remaining, 2000)),
          ),
        ]);

        if (newPage && typeof newPage !== 'number' && 'url' in newPage) {
          const url = (newPage as Page).url();
          if (
            url.includes('secondary_popup') ||
            url.includes('notification')
          ) {
            this.activePage = newPage as Page;
            return newPage as Page;
          }
        }
      } catch {
        // Timeout on waitForEvent, retry
      }
    }

    throw new Error(
      `Notification page did not appear within ${timeoutMs}ms`,
    );
  }

  // ── Screenshots ────────────────────────────────────

  async screenshot(
    options: SessionScreenshotOptions,
  ): Promise<ScreenshotResult> {
    const page = this.getTargetPage(options.target || 'active');

    const screenshotDir = path.resolve(SCREENSHOT_DIR);
    fs.mkdirSync(screenshotDir, { recursive: true });

    const filename = `tl-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, filename);

    const buffer = await page.screenshot({
      path: filePath,
      fullPage: options.fullPage,
    });

    const base64 = buffer.toString('base64');

    // Get viewport dimensions
    const viewport = page.viewportSize() || { width: 0, height: 0 };

    return {
      path: filePath,
      base64,
      width: viewport.width,
      height: viewport.height,
    };
  }

  // ── Capabilities ───────────────────────────────────

  getBuildCapability(): BuildCapability | undefined {
    return this.config.capabilities?.build;
  }

  getFixtureCapability(): FixtureCapability | undefined {
    return this.config.capabilities?.fixture;
  }

  getChainCapability(): ChainCapability | undefined {
    return this.config.capabilities?.chain;
  }

  getContractSeedingCapability(): ContractSeedingCapability | undefined {
    return this.config.capabilities?.contractSeeding;
  }

  getStateSnapshotCapability(): StateSnapshotCapability | undefined {
    return this.config.capabilities?.stateSnapshot;
  }

  getMockServerCapability(): MockServerCapability | undefined {
    return this.config.capabilities?.mockServer;
  }

  getMultiSigCapability(): MultiSigCapability | undefined {
    return this.config.capabilities?.multiSig;
  }

  getOnChainCapability(): OnChainCapability | undefined {
    return this.config.capabilities?.onChain;
  }

  getGasFreeCapability(): GasFreeCapability | undefined {
    return this.config.capabilities?.gasFree;
  }

  // ── Environment ────────────────────────────────────

  getEnvironmentMode(): EnvironmentMode {
    return this.mode;
  }

  setContext(
    context: 'e2e' | 'prod',
    _options?: Record<string, unknown>,
  ): void {
    if (this.hasActiveSession()) {
      throw new Error(
        'Cannot switch context while session is active.',
      );
    }
    this.mode = context;
  }

  getContextInfo() {
    const capabilities: string[] = [];
    if (this.config.capabilities?.build) capabilities.push('build');
    if (this.config.capabilities?.fixture) capabilities.push('fixture');
    if (this.config.capabilities?.chain) capabilities.push('chain');
    if (this.config.capabilities?.contractSeeding)
      capabilities.push('contractSeeding');
    if (this.config.capabilities?.stateSnapshot)
      capabilities.push('stateSnapshot');
    if (this.config.capabilities?.mockServer)
      capabilities.push('mockServer');
    if (this.config.capabilities?.multiSig)
      capabilities.push('multiSig');
    if (this.config.capabilities?.onChain)
      capabilities.push('onChain');
    if (this.config.capabilities?.gasFree)
      capabilities.push('gasFree');

    return {
      currentContext: this.mode,
      hasSession: this.hasActiveSession(),
      sessionId: this.sessionId,
      capabilities,
      canSwitchContext: !this.hasActiveSession(),
    };
  }

  // ── Dialog history ─────────────────────────────────

  /** Get recent auto-handled dialog records. */
  getDialogHistory(): DialogRecord[] {
    return [...this.dialogHistory];
  }

  /** Get and clear the last dialog record. */
  popLastDialog(): DialogRecord | undefined {
    return this.dialogHistory.pop();
  }

  // ── Private helpers ────────────────────────────────

  /**
   * Install automatic dialog handlers on a BrowserContext.
   *
   * Handles all browser-native dialogs (alert, confirm, prompt, beforeunload)
   * that would otherwise block all Playwright operations indefinitely.
   *
   * Strategy:
   * - alert / beforeunload → accept (dismiss the dialog)
   * - confirm → accept (click OK)
   * - prompt → accept with empty string
   *
   * All handled dialogs are recorded in dialogHistory for debugging.
   * Also installs handler on every new page via the 'page' event.
   */
  private installContextDialogHandler(context: BrowserContext): void {
    // Handle dialogs on all existing pages
    for (const page of context.pages()) {
      this.installPageDialogHandler(page);
    }

    // Handle dialogs on any future pages
    context.on('page', (page) => {
      this.installPageDialogHandler(page);
    });
  }

  private installPageDialogHandler(page: Page): void {
    page.on('dialog', async (dialog) => {
      const record: DialogRecord = {
        type: dialog.type() as DialogRecord['type'],
        message: dialog.message(),
        url: page.url(),
        timestamp: new Date().toISOString(),
        action: 'accepted',
      };

      try {
        // Accept all dialogs to unblock the page
        await dialog.accept();
      } catch {
        // If accept fails (e.g. dialog already dismissed), try dismiss
        try {
          await dialog.dismiss();
          record.action = 'dismissed';
        } catch {
          // Dialog already gone, ignore
        }
      }

      // Store in history (keep last 20)
      this.dialogHistory.push(record);
      if (this.dialogHistory.length > 20) {
        this.dialogHistory.shift();
      }

      // Log for debugging
      const logMsg = `[dialog-auto] ${record.type}: "${record.message.substring(0, 100)}" → ${record.action}`;
      process.stderr.write(`[tronlink-mcp] ${logMsg}\n`);
    });
  }

  private getExtensionBaseUrl(): string {
    return `chrome-extension://${this.extensionId}/popup/popup.html`;
  }

  private getTargetPage(target: string): Page {
    if (target === 'active') {
      return this.getPage();
    }

    const pages = this.getTrackedPages();
    const match = pages.find((p) => p.role === target);
    return match ? match.page : this.getPage();
  }

  private detectScreenFromUrl(url: string): string {
    if (!url) return 'unknown';
    if (url.includes('#/home')) return 'home';
    if (url.includes('#/guide')) return 'guide';
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
    if (url.includes('#/user_agreement')) return 'user_agreement';
    if (url.includes('#/backup')) return 'backup';
    if (url.includes('secondary_popup')) return 'notification';
    if (url.includes('popup.html')) return 'home';
    return 'unknown';
  }
}
