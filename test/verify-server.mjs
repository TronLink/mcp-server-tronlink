/**
 * mcp-server-tronlink 验证测试
 *
 * 不启动真实浏览器，验证：
 * 1. TronLinkSessionManager 类导入 & 实例化
 * 2. TronLinkBuildCapability 类导入 & 实例化
 * 3. TronLinkStateSnapshotCapability 类导入 & 实例化
 * 4. SessionManager 配置 & 属性
 * 5. ISessionManager 接口方法完整性
 * 6. 上下文切换逻辑
 * 7. Capability 注册 & 获取
 * 8. 与 @tronlink/mcp-core 集成（setSessionManager + 工具调用）
 * 9. 屏幕检测逻辑（URL → screen name 映射）
 * 10. 标签页分类逻辑
 */

import { TronLinkSessionManager } from '../dist/session-manager.js';
import { TronLinkBuildCapability } from '../dist/capabilities/build.js';
import { TronLinkStateSnapshotCapability } from '../dist/capabilities/state-snapshot.js';
import {
  setSessionManager,
  getSessionManager,
  hasSessionManager,
  getToolDefinitions,
  getToolHandler,
  createMcpServer,
  KnowledgeStore,
  setKnowledgeStore,
  KNOWLEDGE_DIR,
  TRONLINK_URLS,
  SCREENS,
  ErrorCodes,
} from '@tronlink/mcp-core';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 1: 模块导入 ═══');

assert(typeof TronLinkSessionManager === 'function', 'TronLinkSessionManager 是构造函数');
assert(typeof TronLinkBuildCapability === 'function', 'TronLinkBuildCapability 是构造函数');
assert(typeof TronLinkStateSnapshotCapability === 'function', 'TronLinkStateSnapshotCapability 是构造函数');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 2: SessionManager 实例化 & 默认配置 ═══');

const sm = new TronLinkSessionManager({
  extensionPath: '/tmp/fake-extension-path',
});

assert(sm !== null, '实例创建成功');
assert(sm.hasActiveSession() === false, '初始状态无活跃会话');
assert(sm.getSessionId() === undefined, 'sessionId 初始为 undefined');
assert(sm.getSessionState() === undefined, 'sessionState 初始为 undefined');
assert(sm.getSessionMetadata() === undefined, 'sessionMetadata 初始为 undefined');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 3: 环境模式 & 上下文切换 ═══');

const smProd = new TronLinkSessionManager({
  extensionPath: '/tmp/fake',
  mode: 'prod',
});
assert(smProd.getEnvironmentMode() === 'prod', '默认 mode = prod');

const smE2e = new TronLinkSessionManager({
  extensionPath: '/tmp/fake',
  mode: 'e2e',
});
assert(smE2e.getEnvironmentMode() === 'e2e', 'mode = e2e 设定正确');

// 上下文切换（无活跃会话时应成功）
smProd.setContext('e2e');
assert(smProd.getEnvironmentMode() === 'e2e', 'setContext prod→e2e 成功');

smProd.setContext('prod');
assert(smProd.getEnvironmentMode() === 'prod', 'setContext e2e→prod 成功');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 4: getContextInfo ═══');

const info = smProd.getContextInfo();
assert(info.currentContext === 'prod', 'currentContext = prod');
assert(info.hasSession === false, 'hasSession = false');
assert(info.sessionId === undefined, 'sessionId undefined');
assert(info.canSwitchContext === true, 'canSwitchContext = true');
assert(Array.isArray(info.capabilities), 'capabilities 是数组');
assert(info.capabilities.length === 0, '无 capability 注册时为空');

// 带 capabilities 的
const smWithCaps = new TronLinkSessionManager({
  extensionPath: '/tmp/fake',
  capabilities: {
    build: new TronLinkBuildCapability('/tmp/fake-src'),
    stateSnapshot: new TronLinkStateSnapshotCapability(),
  },
});
const infoWithCaps = smWithCaps.getContextInfo();
assert(infoWithCaps.capabilities.includes('build'), 'capabilities 包含 build');
assert(infoWithCaps.capabilities.includes('stateSnapshot'), 'capabilities 包含 stateSnapshot');
assert(infoWithCaps.capabilities.length === 2, 'capabilities 长度为 2');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 5: Capability 获取 ═══');

assert(smWithCaps.getBuildCapability() !== undefined, 'getBuildCapability 返回实例');
assert(smWithCaps.getStateSnapshotCapability() !== undefined, 'getStateSnapshotCapability 返回实例');
assert(smWithCaps.getFixtureCapability() === undefined, 'getFixtureCapability 返回 undefined');
assert(smWithCaps.getChainCapability() === undefined, 'getChainCapability 返回 undefined');
assert(smWithCaps.getContractSeedingCapability() === undefined, 'getContractSeedingCapability 返回 undefined');
assert(smWithCaps.getMockServerCapability() === undefined, 'getMockServerCapability 返回 undefined');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 6: BuildCapability 属性 ═══');

const buildCap = new TronLinkBuildCapability('/tmp/src-path', '/tmp/out-path');
assert(buildCap.getExtensionPath() === '/tmp/out-path', 'getExtensionPath 返回输出路径');
assert(typeof buildCap.build === 'function', 'build 方法存在');
assert(typeof buildCap.isBuilt === 'function', 'isBuilt 方法存在');

// isBuilt 对于不存在的路径应返回 false
const isBuilt = await buildCap.isBuilt();
assert(isBuilt === false, 'isBuilt 对不存在路径返回 false');

// 默认输出路径
const buildCapDefault = new TronLinkBuildCapability('/tmp/src-path');
assert(buildCapDefault.getExtensionPath() === '/tmp/src-path/dist', '默认 outputPath = src/dist');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 7: StateSnapshotCapability ═══');

const stateSnap = new TronLinkStateSnapshotCapability();
assert(typeof stateSnap.getState === 'function', 'getState 方法存在');
assert(typeof stateSnap.detectCurrentScreen === 'function', 'detectCurrentScreen 方法存在');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 8: ISessionManager 接口方法完整性 ═══');

const requiredMethods = [
  // Session lifecycle
  'hasActiveSession', 'getSessionId', 'getSessionState', 'getSessionMetadata',
  'launch', 'cleanup',
  // Page management
  'getPage', 'setActivePage', 'getTrackedPages', 'classifyPageRole', 'getContext',
  // Extension state
  'getExtensionState',
  // A11y refs
  'setRefMap', 'getRefMap', 'clearRefMap', 'resolveA11yRef',
  // Navigation
  'navigateToHome', 'navigateToSettings', 'navigateToUrl', 'navigateToNotification',
  'waitForNotificationPage',
  // Screenshots
  'screenshot',
  // Capabilities
  'getBuildCapability', 'getFixtureCapability', 'getChainCapability',
  'getContractSeedingCapability', 'getStateSnapshotCapability', 'getMockServerCapability',
  // Environment
  'getEnvironmentMode', 'setContext', 'getContextInfo',
];

for (const method of requiredMethods) {
  assert(typeof sm[method] === 'function', `ISessionManager.${method}() 存在`);
}

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 9: A11y Ref Map 操作 ═══');

const testMap = new Map([['e1', '#btn-send'], ['e2', '#input-amount']]);
sm.setRefMap(testMap);
assert(sm.getRefMap().size === 2, 'setRefMap + getRefMap 大小正确');
assert(sm.resolveA11yRef('e1') === '#btn-send', 'resolveA11yRef e1 正确');
assert(sm.resolveA11yRef('e2') === '#input-amount', 'resolveA11yRef e2 正确');
assert(sm.resolveA11yRef('e99') === undefined, '不存在的 ref 返回 undefined');

sm.clearRefMap();
assert(sm.getRefMap().size === 0, 'clearRefMap 清空成功');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 10: 无活跃会话时的错误处理 ═══');

let caughtError;

// getPage should throw
try {
  sm.getPage();
  caughtError = null;
} catch (e) {
  caughtError = e;
}
assert(caughtError !== null, 'getPage() 无活跃页面时抛出异常');
assert(caughtError.message.includes('No active page'), '错误消息包含 "No active page"');

// getContext (BrowserContext) should throw
try {
  sm.getContext();
  caughtError = null;
} catch (e) {
  caughtError = e;
}
assert(caughtError !== null, 'getContext() 无浏览器上下文时抛出异常');
assert(caughtError.message.includes('No browser context'), '错误消息包含 "No browser context"');

// getTrackedPages should return empty
assert(sm.getTrackedPages().length === 0, 'getTrackedPages 无上下文时返回空数组');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 11: launch 路径不存在时抛出异常 ═══');

try {
  await sm.launch({ extensionPath: '/tmp/nonexistent-ext-123456' });
  caughtError = null;
} catch (e) {
  caughtError = e;
}
assert(caughtError !== null, 'launch 路径不存在时抛出异常');
assert(caughtError.message.includes('does not exist'), '错误消息包含 "does not exist"');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 12: cleanup 无活跃会话不报错 ═══');

// cleanup without an active session should succeed (return true since no browser to close)
const cleanupResult = await sm.cleanup();
assert(cleanupResult === true, 'cleanup 无活跃会话返回 true（安全清理）');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 13: 与 @tronlink/mcp-core 集成 ═══');

// Register session manager with core
setSessionManager(smWithCaps);
assert(hasSessionManager() === true, 'setSessionManager 注册成功');
assert(getSessionManager() === smWithCaps, 'getSessionManager 返回同一实例');

// Knowledge store
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import * as path from 'node:path';

const tempKnowledgeDir = mkdtempSync(path.join(tmpdir(), 'tl-server-test-'));
const ks = new KnowledgeStore(tempKnowledgeDir);
setKnowledgeStore(ks);

// Get tool definitions
const tools = getToolDefinitions();
assert(tools.length === 31, '通过 core 获取 31 个工具定义');

// Test tool handler for get_context (doesn't need browser)
const getContextHandler = getToolHandler('tl_get_context');
assert(typeof getContextHandler === 'function', 'tl_get_context handler 可获取');

const ctxResult = await getContextHandler({});
assert(ctxResult.ok === true, 'tl_get_context 调用成功');
assert(ctxResult.result.context === 'prod', 'context = prod（默认模式）');
assert(ctxResult.result.capabilities.includes('build'), 'capabilities 包含 build');
assert(ctxResult.result.capabilities.includes('stateSnapshot'), 'capabilities 包含 stateSnapshot');

// Test set_context
const setContextHandler = getToolHandler('tl_set_context');
const setResult = await setContextHandler({ context: 'e2e' });
assert(setResult.ok === true, 'tl_set_context 切换到 e2e 成功');
assert(smWithCaps.getEnvironmentMode() === 'e2e', 'SessionManager mode 已更新为 e2e');

// Verify via get_context
const ctxResult2 = await getContextHandler({});
assert(ctxResult2.result.context === 'e2e', 'get_context 确认 context = e2e');

// Switch back
await setContextHandler({ context: 'prod' });
assert(smWithCaps.getEnvironmentMode() === 'prod', 'mode 恢复为 prod');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 14: 工具调用（需要会话的工具应返回错误） ═══');

// get_state without active session should return error
const getStateHandler = getToolHandler('tl_get_state');
const stateResult = await getStateHandler({});
assert(stateResult.ok === false, 'tl_get_state 无活跃会话返回错误');
assert(stateResult.error.code === ErrorCodes.TL_NO_ACTIVE_SESSION, '错误码 TL_NO_ACTIVE_SESSION');

// screenshot without active session
const screenshotHandler = getToolHandler('tl_screenshot');
const ssResult = await screenshotHandler({});
assert(ssResult.ok === false, 'tl_screenshot 无活跃会话返回错误');

// click without active session
const clickHandler = getToolHandler('tl_click');
const clickResult = await clickHandler({ a11yRef: 'e1' });
assert(clickResult.ok === false, 'tl_click 无活跃会话返回错误');

// navigate without active session
const navHandler = getToolHandler('tl_navigate');
const navResult = await navHandler({ target: 'home' });
assert(navResult.ok === false, 'tl_navigate 无活跃会话返回错误');

// cleanup without active session (special: returns error via handler)
const cleanupHandler = getToolHandler('tl_cleanup');
const cleanupRes = await cleanupHandler({});
assert(cleanupRes.ok === false, 'tl_cleanup 无活跃会话返回错误');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 15: 知识库工具 ═══');

const knLastHandler = getToolHandler('tl_knowledge_last');
const knLastResult = await knLastHandler({});
assert(knLastResult.ok === true, 'tl_knowledge_last 成功');
assert(Array.isArray(knLastResult.result), '返回数组（steps）');

const knSessionsHandler = getToolHandler('tl_knowledge_sessions');
const knSessionsResult = await knSessionsHandler({});
assert(knSessionsResult.ok === true, 'tl_knowledge_sessions 成功');
assert(Array.isArray(knSessionsResult.result), '返回数组（sessions）');

const knSearchHandler = getToolHandler('tl_knowledge_search');
const knSearchResult = await knSearchHandler({ query: 'test query' });
assert(knSearchResult.ok === true, 'tl_knowledge_search 成功');
assert(Array.isArray(knSearchResult.result), '返回数组（matches）');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 16: MCP Server 创建（使用真实 SessionManager） ═══');

const server = createMcpServer({
  name: 'Test TronLink Server',
  version: '0.1.0',
  logger: () => {},
});

assert(server !== null, 'createMcpServer 成功');
assert(typeof server.start === 'function', 'server.start 是函数');
assert(typeof server.stop === 'function', 'server.stop 是函数');
assert(server.getToolPrefix() === 'tl', '工具前缀 = tl');
assert(server.getToolDefinitions().length === 31, '服务器注册 31 个工具');

// ═══════════════════════════════════════════════
console.log('\n═══ TEST 17: 标签页分类逻辑 ═══');

// Test classifyPageRole with mock page-like objects
const extId = 'abcdefghijklmnopqrstuvwxyz123456';

// Mock page with url method
function mockPage(url) {
  return { url: () => url };
}

assert(
  smWithCaps.classifyPageRole(mockPage(`chrome-extension://${extId}/popup/popup.html`), extId) === 'extension',
  'popup → extension'
);
assert(
  smWithCaps.classifyPageRole(mockPage(`chrome-extension://${extId}/secondary_popup/secondary_popup.html`), extId) === 'notification',
  'secondary_popup → notification'
);
assert(
  smWithCaps.classifyPageRole(mockPage(`chrome-extension://${extId}/notification.html`), extId) === 'notification',
  'notification.html → notification'
);
assert(
  smWithCaps.classifyPageRole(mockPage('https://sunswap.com'), extId) === 'dapp',
  'https URL → dapp'
);
assert(
  smWithCaps.classifyPageRole(mockPage('http://localhost:3000'), extId) === 'dapp',
  'http URL → dapp'
);
assert(
  smWithCaps.classifyPageRole(mockPage('file:///tmp/test.html'), extId) === 'dapp',
  'file:// URL → dapp'
);
assert(
  smWithCaps.classifyPageRole(mockPage('about:blank'), extId) === 'other',
  'about:blank → other'
);
assert(
  smWithCaps.classifyPageRole(mockPage('chrome://extensions'), extId) === 'other',
  'chrome://extensions → other'
);

// ═══════════════════════════════════════════════
// Cleanup temp dir
import { rmSync } from 'node:fs';
try { rmSync(tempKnowledgeDir, { recursive: true }); } catch {}

// ═══════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════\n');
console.log(`📊 mcp-server-tronlink 验证结果: ${passed} 通过, ${failed} 失败`);
console.log();
process.exit(failed > 0 ? 1 : 0);
