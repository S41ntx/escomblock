// Deployment settings for live mode. Filled in by scripts/deploy-testnet.sh
// (writes app/.env.local). Without a core contract id the app runs in demo mode.
const env = import.meta.env

export const NETWORK = {
  name: (env.VITE_NETWORK as string) || 'testnet',
  rpcUrl: (env.VITE_RPC_URL as string) || 'https://soroban-testnet.stellar.org',
  passphrase:
    (env.VITE_NETWORK_PASSPHRASE as string) || 'Test SDF Network ; September 2015',
  explorer: (env.VITE_EXPLORER as string) || 'https://stellar.expert/explorer/testnet',
}

export const CONTRACTS = {
  core: (env.VITE_CORE_ID as string) || '',
  market: (env.VITE_MARKET_ID as string) || '',
  usdc: (env.VITE_USDC_ID as string) || '',
  escb: (env.VITE_ESCB_ID as string) || '',
}

export const LIVE_AVAILABLE = Boolean(
  CONTRACTS.core && CONTRACTS.market && CONTRACTS.usdc && CONTRACTS.escb,
)

/** Build-time flag: the single-file artifact build is always demo-only. */
export const FORCE_DEMO = env.VITE_FORCE_DEMO === '1'
