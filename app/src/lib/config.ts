// Network and contract settings, read at build time from VITE_* variables
// (see app/.env.example; scripts/deploy.sh writes app/.env.production.local).
import { Asset, Networks } from '@stellar/stellar-sdk'

type NetworkName = 'mainnet' | 'testnet' | 'local'

const PRESETS: Record<NetworkName, { passphrase: string; rpcUrl: string; explorer: string; usdc: string }> = {
  mainnet: {
    passphrase: Networks.PUBLIC,
    // SDF runs no public mainnet RPC: set VITE_RPC_URL to your provider.
    rpcUrl: '',
    explorer: 'https://stellar.expert/explorer/public',
    // Circle USDC
    usdc: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  testnet: {
    passphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    explorer: 'https://stellar.expert/explorer/testnet',
    // Circle testnet USDC
    usdc: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  // Development only: `stellar container start local` / stellar/quickstart --local
  local: {
    passphrase: Networks.STANDALONE,
    rpcUrl: 'http://localhost:8000/rpc',
    explorer: 'http://localhost:8000',
    usdc: '',
  },
}

const env = import.meta.env
const name: NetworkName = env.VITE_NETWORK === 'testnet' || env.VITE_NETWORK === 'local' ? env.VITE_NETWORK : 'mainnet'
const preset = PRESETS[name]

function parseAsset(spec: string): Asset | null {
  const [code, issuer] = spec.split(':')
  try {
    return code && issuer ? new Asset(code, issuer) : null
  } catch {
    return null
  }
}

export const NETWORK = {
  name,
  label: { mainnet: 'Stellar', testnet: 'Stellar testnet', local: 'red local' }[name],
  passphrase: preset.passphrase,
  rpcUrl: (env.VITE_RPC_URL as string) || preset.rpcUrl,
  explorer: preset.explorer,
}

export const ASSETS = {
  usdc: parseAsset((env.VITE_USDC_ASSET as string) || preset.usdc),
  escb: parseAsset((env.VITE_ESCB_ASSET as string) || ''),
}

export const CONTRACTS = {
  core: (env.VITE_CORE_ID as string) || '',
  market: (env.VITE_MARKET_ID as string) || '',
  usdc: ASSETS.usdc ? ASSETS.usdc.contractId(NETWORK.passphrase) : '',
  escb: ASSETS.escb ? ASSETS.escb.contractId(NETWORK.passphrase) : '',
}

/** Settings that are missing, by variable name. Empty when the app can run. */
export const MISSING: string[] = [
  !NETWORK.rpcUrl && 'VITE_RPC_URL',
  !CONTRACTS.core && 'VITE_CORE_ID',
  !CONTRACTS.market && 'VITE_MARKET_ID',
  !ASSETS.escb && 'VITE_ESCB_ASSET',
  !ASSETS.usdc && 'VITE_USDC_ASSET',
].filter(Boolean) as string[]
