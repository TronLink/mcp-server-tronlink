# mcp-server-tronlink

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TRON Network](https://img.shields.io/badge/Network-TRON-red)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6)
![MCP](https://img.shields.io/badge/MCP-1.22.0+-blue)
![TronLink](https://img.shields.io/badge/Wallet-TronLink-2B71FF)
![npm](https://img.shields.io/badge/npm-@tronlink/mcp--server--tronlink-CB3837)

TronLink MCP Server — a production-ready MCP server that enables AI agents (Claude, GPT, etc.) to interact with the TRON blockchain through natural language.

Built on `@tronlink/tronlink-mcp-core`, it provides two operation modes:

- **Playwright Mode** — browser automation to control the TronLink Chrome extension UI (navigate, click, type, screenshot, etc.)
- **Direct API Mode** — on-chain operations via TronGrid API, GasFree transfers, and multi-signature management — no browser required

---

## Architecture

```
┌──────────────────────────────────────────────┐
│   AI Agent (Claude Desktop / Claude Code)    │
└──────────────────┬───────────────────────────┘
                   │ MCP Protocol (stdio)
┌──────────────────▼───────────────────────────┐
│  @tronlink/mcp-server-tronlink               │
│                                              │
│  ┌── Playwright Mode ─────────────────────┐  │
│  │  TronLinkSessionManager                │  │
│  │  ├── Browser launch & extension load   │  │
│  │  ├── Extension ID auto-detection       │  │
│  │  ├── Multi-tab tracking & role classify │  │
│  │  ├── State extraction (DOM analysis)   │  │
│  │  │   ├── TRON address (T-prefix, 34ch) │  │
│  │  │   ├── TRX balance                   │  │
│  │  │   ├── Network (Mainnet/Nile/Shasta) │  │
│  │  │   └── Screen detection (15 screens) │  │
│  │  └── Confirmation popup handling       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌── Direct API Mode ─────────────────────┐  │
│  │  TronLinkOnChainCapability (14 tools)  │  │
│  │  ├── TRX/TRC20 transfer, swap, stake  │  │
│  │  ├── Account & resource queries       │  │
│  │  └── Multi-sig setup & signing        │  │
│  │                                        │  │
│  │  TronLinkGasFreeCapability (3 tools)   │  │
│  │  ├── Zero-gas TRC20 transfers         │  │
│  │  └── Account & transaction queries    │  │
│  │                                        │  │
│  │  TronLinkMultiSigCapability (5 tools)  │  │
│  │  ├── Permission queries               │  │
│  │  ├── Transaction submit & list        │  │
│  │  └── WebSocket real-time monitoring   │  │
│  └────────────────────────────────────────┘  │
│                    │ (uses)                   │
│  ┌─────────────────▼──────────────────────┐  │
│  │  @tronlink/tronlink-mcp-core               │  │
│  │  ├── MCP Server (stdio transport)      │  │
│  │  ├── 56+ tl_* tool handlers            │  │
│  │  ├── Knowledge Store                   │  │
│  │  └── Discovery Utils                   │  │
│  └────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────┘
                   │ Playwright (Chromium)     ← only for Playwright mode
┌──────────────────▼───────────────────────────┐
│  Chrome Browser                              │
│  ├── TronLink Extension (MV3)                │
│  │   ├── popup.html#/home                    │
│  │   ├── popup.html#/login                   │
│  │   ├── popup.html#/settings                │
│  │   ├── popup.html#/transfer                │
│  │   └── secondary_popup.html (confirmations)│
│  └── DApp Pages                              │
└──────────────────────────────────────────────┘
```

---

## Quick Start

### Zero-Config Mode (Fastest)

Just configure `TL_TRONGRID_URL`. If no wallet exists, the server starts and shows two setup options instead of creating one immediately:

```json
{
  "mcpServers": {
    "tronlink": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": ".",
      "env": {
        "TL_TRONGRID_URL": "https://nile.trongrid.io"
      }
    }
  }
}
```

1. **Auto-create via MCP tool**: call `tl_wallet_create`
   The server generates a random password, saves it to `~/.agent-wallet/runtime_secrets.json`, creates an encrypted `main` wallet, and enables the running session to use it.
2. **Manual CLI setup**:
   1. Create a wallet: `agent-wallet start local_secure --generate --wallet-id main`
   2. Add `AGENT_WALLET_PASSWORD` to your `.mcp.json` env (must match the password used above)
   3. Restart the MCP server

### Manual Setup (Existing Wallet or CLI-First)

If you prefer to create a wallet yourself or use an existing one:

1. Create a wallet: `agent-wallet start local_secure --generate --wallet-id main`
2. Add `AGENT_WALLET_PASSWORD` to your `.mcp.json` env (must match the password used above)
3. Restart the MCP server

Once a wallet is configured (auto or manual), on-chain tools (`tl_chain_*`, `tl_gasfree_*`, `tl_multisig_*`) become available.

### Playwright Setup

#### 1. Build TronLink Extension (Playwright mode only)

```bash
cd /path/to/tronlink-extension-pro
npm install
npm run build
# Output: dist/
```

#### 2. Install and Build MCP Server

```bash
cd /path/to/mcp-server-tronlink
npm install
npm run build
```

#### 3. Create Wallet Locally (required for on-chain tools)

```bash
npm install -g @bankofai/agent-wallet
agent-wallet start local_secure --generate --wallet-id main
```

#### 4. Configure MCP JSON

All configuration is injected via the `env` field in the MCP JSON. The server does **not** read `.env` files.

See the "Integration" section below. For variable reference, see `.env.example`.

---

## Two Operation Modes

### Playwright Mode — Browser Automation

Controls the TronLink Chrome extension through Playwright. Requires a built TronLink extension.

**Use when you need to:**
- Automate wallet UI interactions (import wallet, navigate screens, click buttons)
- Test DApp integrations (connect wallet, sign transactions via popup)
- Take screenshots of wallet/DApp state
- Run end-to-end tests against the TronLink UI

**Tools (27):** `tl_launch`, `tl_cleanup`, `tl_navigate`, `tl_click`, `tl_type`, `tl_screenshot`, `tl_get_state`, `tl_describe_screen`, `tl_accessibility_snapshot`, `tl_list_testids`, `tl_switch_to_tab`, `tl_close_tab`, `tl_wait_for`, `tl_wait_for_notification`, `tl_scroll`, `tl_keyboard`, `tl_evaluate`, `tl_clipboard`, `tl_seed_contract`, `tl_seed_contracts`, `tl_get_contract_address`, `tl_list_contracts`, `tl_set_context`, `tl_get_context`, `tl_run_steps`, `tl_list_flows`, `tl_list_testids`

### Direct API Mode — On-Chain Operations

Calls TRON blockchain APIs directly using TronWeb-compatible REST calls and local cryptographic signing. **No browser or extension required.**

**Use when you need to:**
- Query account balances, resources, and transaction history
- Send TRX or TRC20 tokens programmatically
- Stake/unstake TRX, delegate bandwidth/energy
- Execute token swaps via SunSwap V2/V3
- Manage multi-signature wallets and transactions
- Send gas-free TRC20 transfers

**Tool groups:**

| Group | Tools | Required Config |
|-------|-------|----------------|
| **On-Chain** (14) | `tl_chain_*` | `agent-wallet` + `TL_TRONGRID_URL` |
| **MultiSig** (5) | `tl_multisig_*` | `TL_MULTISIG_BASE_URL` + credentials |
| **GasFree** (3) | `tl_gasfree_*` | `TL_GASFREE_BASE_URL` + API key |

**Both modes can run simultaneously** — configure what you need and the server enables the corresponding tools automatically.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| **Playwright Mode** | | |
| `TRONLINK_EXTENSION_PATH` | TronLink extension build directory (containing `manifest.json`) | Auto-detected |
| `TRONLINK_SOURCE_PATH` | TronLink extension source directory (enables Build capability) | — |
| `TL_MODE` | Working mode: `e2e` (test) or `prod` (production) | `prod` |
| `TL_HEADLESS` | Run browser in headless mode: `true` / `false` | `false` |
| `TL_SLOW_MO` | Playwright slow-motion delay in ms (for debugging) | `0` |
| **TronGrid API** | | |
| `TL_TRONGRID_URL` | TronGrid full-node API URL | — |
| `TL_TRONGRID_API_KEY` | TronGrid API Key (required for Mainnet, not needed for Nile/Shasta) | — |
| **Wallet (agent-wallet)** | | |
| `AGENT_WALLET_PASSWORD` | Encryption password (optional if using `tl_wallet_create`; required for manual or existing wallets) | Auto-generated by `tl_wallet_create` |
| `AGENT_WALLET_DIR` | Custom wallet storage directory | `~/.agent-wallet` |
| `TL_OWNER_WALLET_ID` | Owner wallet ID for multisig signing | active wallet |
| `TL_COSIGNER_WALLET_ID` | Co-signer wallet ID for multisig | — |
| **On-Chain** | | |
| `TL_SUNSWAP_ROUTER` | SunSwap V2 Router contract address | — |
| `TL_SUNSWAP_V3_ROUTER` | SunSwap Smart Router (V3) contract address | — |
| `TL_WTRX_ADDRESS` | WTRX contract address | Mainnet default |
| **Multi-Signature** | | |
| `TL_MULTISIG_BASE_URL` | Multi-sig service API URL | — |
| `TL_MULTISIG_SECRET_ID` | Multi-sig service Secret ID | — |
| `TL_MULTISIG_SECRET_KEY` | Multi-sig service Secret Key (HmacSHA256 signing key) | — |
| `TL_MULTISIG_CHANNEL` | Multi-sig service channel name | — |
| **GasFree** | | |
| `TL_GASFREE_BASE_URL` | GasFree service URL | — |
| `TL_GASFREE_API_KEY` | GasFree API Key | — |
| `TL_GASFREE_API_SECRET` | GasFree API Secret | — |

> Configuring multisig env vars (`BASE_URL` + `SECRET_ID` + `SECRET_KEY` + `CHANNEL`) auto-enables the `tl_multisig_*` tools.
>
> Configuring `agent-wallet` + `TL_TRONGRID_URL` enables the `tl_chain_*` on-chain tool group (14 tools).
>
> Configuring `TL_GASFREE_BASE_URL` + `TL_GASFREE_API_KEY` enables the `tl_gasfree_*` gas-free transfer tool group (3 tools).
>
> **Security**: Private keys are managed by `@bankofai/agent-wallet` with encrypted local storage (`local_secure`). Plain-text keys in env vars are not supported. If no wallet exists at startup, the server shows two paths: call `tl_wallet_create` to auto-generate one (password saved to `~/.agent-wallet/runtime_secrets.json`), or create one manually via CLI and set `AGENT_WALLET_PASSWORD`.

### API Key Acquisition Guide

#### TronGrid API Key (required for on-chain operations)

> Used by all `tl_chain_*` tools (balance queries, transfers, staking, swaps, etc.)

| Item | Details |
|------|---------|
| **Portal** | https://www.trongrid.io/ |
| **Cost** | Free (100,000 requests/day); paid plans available |
| **Testnet** | Nile/Shasta do **not** require an API Key |
| **Mainnet** | API Key is **required** |

**Steps:**
1. Visit https://www.trongrid.io/ → click `Sign Up`
2. Register with email and verify
3. Go to Dashboard → `Create API Key`
4. Enter project name → generate key
5. Copy the API Key into `TL_TRONGRID_API_KEY`

#### GasFree API Key (gas-free TRC20 transfers)

> Used by `tl_gasfree_*` tools — TRC20 token transfers where gas fees are paid by the service provider

| Item | Details |
|------|---------|
| **Developer Center** | https://developer.gasfree.io/ |
| **API Spec** | https://gasfree.io/specification |
| **SDK** | `npm install @gasfree/gasfree-sdk` ([GitHub](https://github.com/gasfreeio/gasfree-sdk-js)) |
| **Testnet URL** | `https://open-test.gasfree.io/nile/` |
| **Mainnet URL** | `https://open.gasfree.io/tron/` |

**Steps:**
1. Visit https://developer.gasfree.io → register a developer account
2. Create an application → system generates `API Key` and `API Secret`
3. Fill in `TL_GASFREE_API_KEY` and `TL_GASFREE_API_SECRET`
4. Note: Nile testnet also requires a key, but approval is fast

#### SunSwap Smart Router Address (DEX trading)

> Used by `tl_chain_swap_v3` — token swaps via SunSwap V3 concentrated liquidity

| Network | Smart Router Address | Source |
|---------|---------------------|--------|
| **Mainnet** | `TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj` | [SUN.io Docs](https://docs.sun.io/developers/swap/smart-router) |
| **Nile** | `TB6xBCixqRPUSKiXb45ky1GhChFJ7qrfFj` | Same |

No application needed — just set the address in `TL_SUNSWAP_V3_ROUTER`.

The Smart Router is SunSwap's unified entry point that automatically selects the optimal route across V1/V2/V3/PSM/SunCurve pools.

#### WTRX Contract Address

> Used for TRX ↔ Token swaps (Wrapped TRX)

| Network | WTRX Address |
|---------|-------------|
| **Mainnet** | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` (default, no manual config needed) |
| **Nile** | Query via SunSwap Router's `WETH()` method |

No configuration needed for Mainnet (uses default). For Nile testnet, query the address and set `TL_WTRX_ADDRESS`.

#### Multi-Signature Service Credentials

> Used by `tl_multisig_*` tools — permission queries, transaction submission, real-time monitoring

| Item | Details |
|------|---------|
| **Nile Testnet** | `https://apinile.walletadapter.org` |
| **Mainnet** | `https://api.walletadapter.org` |
| **Test Credentials** | `SECRET_ID=TEST` / `SECRET_KEY=TESTTESTTEST` / `CHANNEL=test` |

**Testnet works out of the box** with the test credentials above.

**Production**: Contact the TronLink team for official credentials.

#### Wallet Setup (Optional — auto-created if not configured)

If no wallet exists, the server will prompt you to choose one of two paths:

1. **Auto-create in the current MCP session**: call `tl_wallet_create`
2. **Manual CLI setup**: create the wallet yourself, then set `AGENT_WALLET_PASSWORD` and restart

Manual CLI commands:

```bash
# 1. Install agent-wallet CLI
npm install -g @bankofai/agent-wallet

# 2. Create an encrypted wallet
agent-wallet start local_secure --generate --wallet-id main

# 3. (Optional) Create a cosigner wallet for multisig
agent-wallet start local_secure --generate --wallet-id cosigner
```

You can also manage wallets at runtime via MCP tools: `tl_wallet_list`, `tl_wallet_create`, `tl_wallet_set_active`.

#### Quick Config Reference (Nile Testnet .mcp.json)

```json
{
  "mcpServers": {
    "tronlink": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": ".",
      "env": {
        "TRONLINK_EXTENSION_PATH": "/path/to/tronlink-extension/dist",
        "TL_MODE": "prod",
        "TL_HEADLESS": "false",
        "TL_TRONGRID_URL": "https://nile.trongrid.io",
        "AGENT_WALLET_PASSWORD": "your-wallet-password",
        "TL_SUNSWAP_ROUTER": "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
        "TL_SUNSWAP_V3_ROUTER": "TB6xBCixqRPUSKiXb45ky1GhChFJ7qrfFj",
        "TL_MULTISIG_BASE_URL": "https://apinile.walletadapter.org",
        "TL_MULTISIG_SECRET_ID": "TEST",
        "TL_MULTISIG_SECRET_KEY": "TESTTESTTEST",
        "TL_MULTISIG_CHANNEL": "test",
        "TL_GASFREE_BASE_URL": "https://open-test.gasfree.io/nile/",
        "TL_GASFREE_API_KEY": "your_gasfree_api_key",
        "TL_GASFREE_API_SECRET": "your_gasfree_api_secret"
      }
    }
  }
}
```

> Testnet TRX faucet: https://nileex.io/join/getJoinPage

#### API-Only Config (no Playwright, no browser)

If you only need direct API tools (on-chain, multisig, gasfree) without browser automation, you can omit `TRONLINK_EXTENSION_PATH`:

```json
{
  "mcpServers": {
    "tronlink": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": ".",
      "env": {
        "TL_TRONGRID_URL": "https://nile.trongrid.io",
        "AGENT_WALLET_PASSWORD": "your-wallet-password",
        "TL_MULTISIG_BASE_URL": "https://apinile.walletadapter.org",
        "TL_MULTISIG_SECRET_ID": "TEST",
        "TL_MULTISIG_SECRET_KEY": "TESTTESTTEST",
        "TL_MULTISIG_CHANNEL": "test",
        "TL_GASFREE_BASE_URL": "https://open-test.gasfree.io/nile/",
        "TL_GASFREE_API_KEY": "your_gasfree_api_key",
        "TL_GASFREE_API_SECRET": "your_gasfree_api_secret"
      }
    }
  }
}
```

This configuration enables API tools (including 3 wallet management tools) without launching a browser. Playwright-based tools (`tl_launch`, `tl_click`, etc.) will not be available. If `AGENT_WALLET_PASSWORD` is omitted, startup will prompt you to choose either `tl_wallet_create` or manual CLI setup.

### Extension Path Auto-Detection

If `TRONLINK_EXTENSION_PATH` is not set, the server searches these locations:

1. `./dist`
2. `./dist/prd`
3. `../tronlink-extension-pro/dist`
4. `../tronlink-extension-pro/dist/prd`

Condition: directory contains a `manifest.json` file.

---

## Integration

### Option 1: Project-Level `.mcp.json` (Recommended)

The project includes a `.mcp.json` file. Claude Code auto-detects it. Fill in your credentials. If no wallet exists yet, either call `tl_wallet_create` after startup, or create the wallet locally first and set `AGENT_WALLET_PASSWORD`:

```bash
# .mcp.json already exists, edit directly
# Fill in TL_MULTISIG_SECRET_ID / SECRET_KEY / CHANNEL etc.
# If you want the manual wallet path, also add AGENT_WALLET_PASSWORD after creating the wallet locally
```

`.mcp.json` example:

```json
{
  "mcpServers": {
    "tronlink": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": ".",
      "env": {
        "TRONLINK_EXTENSION_PATH": "../tronlink-extension-pro/dist",
        "TL_MODE": "prod",
        "TL_HEADLESS": "false",
        "TL_SLOW_MO": "0",
        "TL_TRONGRID_URL": "https://nile.trongrid.io",
        "AGENT_WALLET_PASSWORD": "your-wallet-password",
        "TL_TRONGRID_API_KEY": "",
        "TL_MULTISIG_BASE_URL": "https://apinile.walletadapter.org",
        "TL_MULTISIG_SECRET_ID": "your-secret-id",
        "TL_MULTISIG_SECRET_KEY": "your-secret-key",
        "TL_MULTISIG_CHANNEL": "your-channel"
      }
    }
  }
}
```

> `.mcp.json` is in `.gitignore` and will not be committed.

### Option 2: Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tronlink": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-tronlink/dist/index.js"],
      "env": {
        "TRONLINK_EXTENSION_PATH": "/absolute/path/to/tronlink-extension-pro/dist",
        "TL_TRONGRID_URL": "https://nile.trongrid.io",
        "AGENT_WALLET_PASSWORD": "your-wallet-password",
        "TL_MULTISIG_BASE_URL": "https://apinile.walletadapter.org",
        "TL_MULTISIG_SECRET_ID": "your-secret-id",
        "TL_MULTISIG_SECRET_KEY": "your-secret-key",
        "TL_MULTISIG_CHANNEL": "your-channel"
      }
    }
  }
}
```

### Option 3: Claude Code Global Settings

Edit `~/.claude/settings.json` or project-level `.claude/settings.json`:

```json
{
  "mcpServers": {
    "tronlink": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-tronlink/dist/index.js"],
      "env": {
        "TRONLINK_EXTENSION_PATH": "/absolute/path/to/tronlink-extension-pro/dist",
        "TL_TRONGRID_URL": "https://nile.trongrid.io",
        "AGENT_WALLET_PASSWORD": "your-wallet-password"
      }
    }
  }
}
```

### Other MCP Clients

Any client supporting the MCP protocol (stdio transport) can connect. The server communicates via stdin/stdout and handles `tools/list` and `tools/call` requests.

---

## Usage Examples

### Example 1: Direct API — Query Account and Send TRX

```
User: What is the balance of my account, and send 10 TRX to TAbCdEf...

AI executes:
1. tl_chain_get_address()
   → { address: "TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF" }

2. tl_chain_get_account({ address: "TVGcWWdJn9EnJP1LHCJDQaVCEcGsapKrVF" })
   → { balance_trx: "100.5", bandwidth: 600, energy: 0, ... }

3. tl_chain_send({ to: "TAbCdEf...", amount: "10" })
   → { txId: "abc123...", success: true }
```

### Example 2: Direct API — Stake TRX and Delegate Energy

```
User: Stake 100 TRX for energy, then delegate energy to TAbCdEf...

AI executes:
1. tl_chain_stake({ action: "freeze", amount_trx: 100, resource: "ENERGY" })
   → { txId: "...", success: true }

2. tl_chain_resource({
     action: "delegate",
     resource: "ENERGY",
     amount_trx: 50,
     receiver: "TAbCdEf..."
   })
   → { txId: "...", success: true }
```

### Example 3: Direct API — Token Swap via SunSwap

```
User: Swap 10 TRX for USDT

AI executes:
1. tl_chain_swap_v3({
     from_token: "TRX",
     to_token: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
     amount: "10",
     slippage: 1
   })
   → { txId: "...", amountOut: "1.52", ... }
```

### Example 4: Direct API — GasFree Transfer

```
User: Send 10 USDT to TAbCdEf... without paying gas

AI executes:
1. tl_gasfree_get_account({ address: "TVGcWWdJn9..." })
   → { eligible: true, daily_quota_remaining: 3, supported_tokens: [...] }

2. tl_gasfree_send({
     to: "TAbCdEf...",
     contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
     amount: "10"
   })
   → { txId: "...", success: true, gas_paid_by: "gasfree" }
```

### Example 5: Direct API — Multi-Signature Workflow

```
User: Check my multisig permissions and submit a transaction

AI executes:
1. tl_multisig_query_auth({ address: "TXz9dfkjui6..." })
   → { permissions: [{ owner_address: "TDqGdq76...",
       active_permissions: [{ threshold: 66, weight: 35 }] }] }

2. tl_multisig_list_tx({ address: "TXz9dfkjui6...", state: 0 })
   → { total: 3, transactions: [{ hash: "18213ab5...",
       threshold: 3, currentWeight: 2, stateText: "processing" }] }

3. tl_multisig_submit_tx({
     address: "TXz9dfkjui6...",
     function_selector: "transfer(address,uint256)",
     transaction: { raw_data: {...}, signature: ["659143f5..."] }
   })
   → { success: true, code: 0, message: "OK" }

4. tl_multisig_connect_ws({ address: "TXz9dfkjui6..." })
   → { connected: true }  // real-time pending tx notifications
```

### Example 6: Playwright — Launch Wallet and Check State

```
User: Launch TronLink and show me the wallet state

AI executes:
1. tl_launch({ fixture: "default" })
   → { sessionId: "tl-1741504523", extensionId: "abc...", extensionUrl: "chrome-extension://..." }

2. tl_get_state()
   → { currentScreen: "home", isUnlocked: true, accountAddress: "TXyz...",
       networkName: "Mainnet", balanceTrx: "100.5" }
```

### Example 7: Playwright — DApp Interaction

```
User: Open SunSwap and connect wallet

AI executes:
1. tl_launch({ fixture: "default" })
2. tl_navigate({ target: "url", url: "https://sunswap.com" })
3. tl_click({ selector: ".connect-wallet-btn" })
4. tl_wait_for_notification({ timeout: 30000 })
5. tl_switch_to_tab({ role: "notification" })
6. tl_describe_screen()
7. tl_click({ a11yRef: "e3" })        // approve connection
8. tl_switch_to_tab({ role: "dapp" })
9. tl_screenshot()
```

---

## Multi-Signature Guide

### Network Reference

| Network | TronGrid URL | Multi-Sig Service URL | API Key |
|---------|-------------|----------------------|---------|
| **Nile Testnet** | `https://nile.trongrid.io` | `https://apinile.walletadapter.org` | Not needed |
| **Shasta Testnet** | `https://api.shasta.trongrid.io` | — | Not needed |
| **Mainnet** | `https://api.trongrid.io` | `https://api.walletadapter.org` | **Required** |

> Testnet TRX faucet: https://nileex.io/join/getJoinPage

### TRON Multi-Sig Permission Model

TRON accounts have three permission levels:

| Permission | ID | Description |
|------------|-----|-------------|
| **owner** | 0 | Highest level — can modify all permissions and execute all contracts |
| **witness** | 1 | Super representative only (block production) |
| **active** | 2+ | Custom permissions — configurable allowed contract types (up to 8) |

Each permission contains:
- **threshold**: Minimum cumulative weight required to execute
- **keys**: Signer list `[{address, weight}]` (up to 5 per permission)
- **operations**: 32-byte hex bitmask defining allowed contract types (active only)

### Multi-Sig Fees

- `accountPermissionUpdate`: 100 TRX
- Each multi-sig transaction: additional 1 TRX

### Multi-Sig Complete Flow

```
1. Setup multi-sig permissions (accountPermissionUpdate)
   ├── Define owner permission (recommended: keep threshold=1 for recovery)
   └── Define active permission (e.g., threshold=2, two signers each weight=1)

2. Create multi-sig transaction (with Permission_id=2)
   └── Transaction specifies active permission

3. Collect signatures
   ├── Signer A signs → submit to multi-sig service
   └── Signer B signs → submit to multi-sig service

4. Auto-broadcast when threshold reached
   └── Service checks currentWeight >= threshold → broadcast
```

### Built-in Multi-Sig Flow Recipes

View with `tl_list_flows`:

| Flow ID | Description |
|---------|-------------|
| `multisig_query_auth` | Query address multi-sig permissions (owner/active, thresholds, weights) |
| `multisig_list_transactions` | List multi-sig transactions (filter by status: pending/success/failed) |
| `multisig_monitor` | WebSocket real-time monitoring + list current pending transactions |
| `multisig_stop_monitor` | Disconnect WebSocket monitoring |
| `multisig_submit_tx` | Submit signed transaction to multi-sig service (auto-broadcast on threshold) |
| `multisig_check` | Full status check: permissions → pending txs → unsigned txs |

### Security Recommendations

1. **Keep owner threshold=1**: When setting up multi-sig, keep the owner permission as single-sig (threshold=1) so you can always recover if active signers are unavailable
2. **Test on testnet first**: Thoroughly test on Nile testnet before operating on Mainnet
3. **Key safety**: Private keys are encrypted via `@bankofai/agent-wallet` (`local_secure` type). Plain-text keys in env vars are not supported. If you use `tl_wallet_create`, the password is saved to `~/.agent-wallet/runtime_secrets.json`; if you use the manual path, set `AGENT_WALLET_PASSWORD` yourself. Do not delete `runtime_secrets.json` — it is required to decrypt existing auto-created wallets
4. **Transaction expiration**: Unsigned transactions expire in ~60 seconds — collect all signatures before expiration

---

## All Available Tools

The server exposes 55+ tools via MCP protocol. Tools are grouped by mode:

### Playwright Mode Tools

**Session Management**: `tl_launch` / `tl_cleanup`

**State & Discovery**: `tl_get_state` / `tl_describe_screen` / `tl_list_testids` / `tl_accessibility_snapshot`

**Navigation**: `tl_navigate` / `tl_switch_to_tab` / `tl_close_tab` / `tl_wait_for_notification`

**UI Interaction**: `tl_click` / `tl_type` / `tl_wait_for` / `tl_scroll` / `tl_keyboard` / `tl_evaluate`

**Screenshot & Clipboard**: `tl_screenshot` / `tl_clipboard`

**Contract Seeding (e2e)**: `tl_seed_contract` / `tl_seed_contracts` / `tl_get_contract_address` / `tl_list_contracts`

**Context**: `tl_set_context` / `tl_get_context`

**Knowledge Store**: `tl_knowledge_last` / `tl_knowledge_search` / `tl_knowledge_summarize` / `tl_knowledge_sessions`

**Batch**: `tl_run_steps`

**Flow Recipes**: `tl_list_flows` (32 built-in recipes with pre-checks)

### Wallet Management Tools

| Tool | Description |
|------|-------------|
| `tl_wallet_list` | List all wallets with IDs, types, active status, and TRON addresses |
| `tl_wallet_create` | Auto-generate an encrypted wallet and attach it to the running MCP session |
| `tl_wallet_set_active` | Switch the active wallet by ID (hot-swaps into all capabilities) |

### Direct API Tools

**On-Chain** (requires `agent-wallet` + `TL_TRONGRID_URL`):

| Tool | Description |
|------|-------------|
| `tl_chain_get_address` | Get TRON address from encrypted agent-wallet |
| `tl_chain_get_account` | Query account: TRX balance, bandwidth, energy, permissions |
| `tl_chain_get_tokens` | Query TRC10 + TRC20 token balances |
| `tl_chain_send` | Send TRX, TRC10, or TRC20 tokens |
| `tl_chain_get_tx` | Get transaction details by txID |
| `tl_chain_get_history` | Query transaction history with pagination |
| `tl_chain_stake` | Freeze/unfreeze TRX for bandwidth or energy (Stake 2.0) |
| `tl_chain_get_staking` | Query staking status: frozen amounts, votes, pending unfreezing |
| `tl_chain_resource` | Delegate/undelegate bandwidth or energy resources |
| `tl_chain_swap` | Estimate or execute token swap via SunSwap V2 |
| `tl_chain_swap_v3` | Execute token swap via SunSwap V3 Smart Router |
| `tl_chain_setup_multisig` | Configure multi-sig permissions (accountPermissionUpdate) |
| `tl_chain_create_multisig_tx` | Create unsigned multi-sig transaction with permission ID |
| `tl_chain_sign_multisig_tx` | Sign multi-sig transaction with owner or co-signer wallet |

**Multi-Signature** (requires multisig service config):

| Tool | Description |
|------|-------------|
| `tl_multisig_query_auth` | Query address multi-sig permissions (thresholds, weights) |
| `tl_multisig_submit_tx` | Submit signed transaction (auto-broadcast on threshold) |
| `tl_multisig_list_tx` | Query transaction history (pending/success/failed, signature progress) |
| `tl_multisig_connect_ws` | Connect WebSocket for real-time pending tx notifications |
| `tl_multisig_disconnect_ws` | Disconnect WebSocket listener |

**GasFree** (requires `TL_GASFREE_BASE_URL` + API key):

| Tool | Description |
|------|-------------|
| `tl_gasfree_get_account` | Query account eligibility, supported tokens, daily quota |
| `tl_gasfree_get_transactions` | Query gas-free transaction history with pagination |
| `tl_gasfree_send` | Send TRC20 token with zero gas fee |

### Pre-Check Mechanism

All transaction tools automatically perform safety checks before execution:

| Operation | Pre-Check |
|-----------|-----------|
| Send TRX | Verify sufficient TRX balance |
| Send TRC20 | Verify sufficient token balance |
| Stake TRX | Verify available TRX balance |
| Unstake TRX | Verify sufficient staked amount |
| Delegate resource | Verify sufficient frozen resources |
| Reclaim delegation | Verify active resource delegation exists |
| Setup multi-sig | Verify TRX balance >= 100 TRX |
| Create multi-sig tx | Verify multi-sig permissions configured |
| Swap (V2/V3) | Verify sufficient source token balance |
| GasFree send | Verify eligibility, token support, daily quota, token balance |

---

## Core Components

### TronLinkSessionManager (Playwright Mode)

Full implementation of the `ISessionManager` interface:

| Feature | Details |
|---------|---------|
| **Browser launch** | Playwright Chromium with `--load-extension` for TronLink |
| **Extension ID resolution** | Auto-extract 32-char ID from `chrome-extension://` URL or Service Worker |
| **Extension readiness** | Wait for React mount on `#root`, confirm non-empty DOM |
| **Screen detection** | URL hash-based detection for 15 TronLink screens |
| **State extraction** | DOM analysis for TRON address (T-prefix, 34 chars), TRX balance, network |
| **Tab tracking** | Auto-classify page roles: extension / notification / dapp / other |
| **Confirmation handling** | Poll + `waitForEvent('page')` for secondary_popup detection |
| **Safe cleanup** | Sequentially close Fixture, Chain, MockServer, then browser |

### TronLinkOnChainCapability (Direct API Mode)

| Feature | Details |
|---------|---------|
| **API calls** | Direct REST calls to TronGrid full-node API |
| **Signing** | Encrypted wallet signing via `@bankofai/agent-wallet` |
| **Address derivation** | Resolved from encrypted wallet |
| **Supported operations** | Transfer, stake, delegate, swap (V2/V3), multisig setup/create/sign |
| **Pre-checks** | Balance and permission validation before every transaction |

### TronLinkGasFreeCapability (Direct API Mode)

| Feature | Details |
|---------|---------|
| **API calls** | GasFree REST API for zero-gas TRC20 transfers |
| **Eligibility check** | Validates account, token support, and daily quota before sending |
| **Signing** | Encrypted wallet signing via `@bankofai/agent-wallet` for GasFree authorization |

### TronLinkMultiSigCapability (Direct API Mode)

| Feature | Details |
|---------|---------|
| **Permission query** | REST call to `/multi/auth` for owner/active permission data |
| **Transaction submit** | REST call to `/multi/transaction` with signed transaction payload |
| **Transaction list** | REST call to `/multi/list` with pagination and status filtering |
| **WebSocket** | Real-time `/multi/socket` connection for pending tx notifications |
| **Auth signing** | Auto-generated HmacSHA256 API signature (sign_version=v1) |

### TronLinkBuildCapability

| Feature | Details |
|---------|---------|
| Build command | Calls TronLink project's `npm run build` / `build:prd:chrome` / `build:mv2` |
| Build detection | Checks output directory for `manifest.json` |
| Timeout | 5 minutes |

### TronLinkStateSnapshotCapability

| Feature | Details |
|---------|---------|
| Screen detection | URL hash matching + password input fallback |
| Address extraction | Regex match `T[A-Za-z1-9]{33}` |
| Balance extraction | Regex match `[\d,.]+\s*TRX` |
| Network detection | DOM scan for Mainnet / Nile / Shasta / Testnet keywords |

---

## Project Structure

```
mcp-server-tronlink/
├── src/
│   ├── index.ts                    # Entry: parse config, register capabilities, start server
│   ├── wallet.ts                   # Unified wallet entry (agent-wallet, encrypted-only, guided auto-create)
│   ├── wallet-tools.ts             # MCP wallet management tools (list, create, switch)
│   ├── session-manager.ts          # TronLinkSessionManager (full ISessionManager implementation)
│   ├── capabilities/
│   │   ├── build.ts                # TronLinkBuildCapability (webpack build)
│   │   ├── state-snapshot.ts       # TronLinkStateSnapshotCapability (UI state extraction)
│   │   ├── multisig.ts             # TronLinkMultiSigCapability (multi-sig REST + WebSocket)
│   │   ├── on-chain.ts             # TronLinkOnChainCapability (14 on-chain operations)
│   │   ├── gasfree.ts              # TronLinkGasFreeCapability (gas-free transfers)
│   │   └── tron-crypto.ts          # TRON crypto utils (address derivation, signing, Base58)
│   └── flows/
│       ├── index.ts                # Flow registration entry (32 built-in recipes)
│       ├── import-wallet.ts        # Import wallet flow (disabled — violates encrypted-only policy)
│       ├── switch-network.ts       # Switch network / enable testnet
│       ├── transfer-trx.ts         # TRX / TRC20 transfer flows
│       ├── multisig.ts             # Multi-sig flows (6 recipes)
│       ├── onchain.ts              # On-chain flows (11 recipes with pre-checks)
│       └── gasfree.ts              # GasFree flows (3 recipes)
├── .env.example                    # Environment variable reference (documentation only)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Current Limitations

- **Chrome extension only**: Currently supports Chrome desktop TronLink extension; mobile support planned
- **DOM dependency**: State extraction relies on TronLink UI DOM structure; UI refactors may require adaptation
- **No data-testid**: TronLink extension does not use data-testid attributes; relies on accessibility tree and CSS selectors
- **Headed mode recommended**: Chrome extensions may have compatibility issues in headless mode

---

## Requirements

- **Node.js** >= 20
- **Playwright** >= 1.49 (with Chromium) — only needed for Playwright mode
- **Built TronLink extension** (`dist/` with `manifest.json`) — only needed for Playwright mode

---

## License

MIT License Copyright (c) 2026 TronLink
