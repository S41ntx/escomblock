export type Mode = 'demo' | 'testnet'

export type BatchStatus = 'Pending' | 'Certified' | 'Rejected'
export type OrderStatus = 'Paid' | 'Shipped' | 'Completed' | 'Cancelled'
export type Role = 'Plant' | 'Lab'

export interface Standard {
  minStrengthMpa: number
  maxAbsorptionPct: number
  minThermalCycles: number
}

export interface Config {
  admin: string
  pricePerKg: number // USDC
  standard: Standard
  feeBps: number
  claimAfterDays: number
}

export interface Delivery {
  id: number
  plant: string
  collector: string
  kg: number
  origin: string
  payout: number // USDC
  timestamp: number // unix seconds
  batchId: number // 0 = unused
}

export interface Certification {
  lab: string
  strengthMpa: number
  absorptionPct: number
  thermalCycles: number
  reportHash: string // hex
  passed: boolean
  timestamp: number
}

export interface Batch {
  id: number
  plant: string
  deliveries: number[]
  rubbleKg: number
  blocks: number
  mix: string
  status: BatchStatus
  createdAt: number
  creditsMinted: number // ESCB
  certification?: Certification
}

export interface Listing {
  id: number
  seller: string
  batchId: number
  pricePerBlock: number
  creditsPerBlock: number
  available: number
  sold: number
  active: boolean
}

export interface Order {
  id: number
  listingId: number
  buyer: string
  seller: string
  qty: number
  total: number
  credits: number
  status: OrderStatus
  createdAt: number
  shippedAt: number
}

export interface Retirement {
  id: number
  by: string
  amount: number
  beneficiary: string
  timestamp: number
}

export interface Stats {
  deliveries: number
  rubbleKg: number
  usdcPaid: number
  batches: number
  certifiedBatches: number
  certifiedBlocks: number
  creditsMinted: number
  creditsRetired: number
  retirements: number
}

export interface Activity {
  id: string
  kind: 'delivery' | 'batch' | 'certify' | 'list' | 'order' | 'retire' | 'info'
  text: string
  timestamp: number
  txHash?: string
}

export interface Account {
  address: string
  name: string
  roles: Role[]
  usdc: number
  escb: number
}

export interface Snapshot {
  config: Config
  stats: Stats
  deliveries: Delivery[]
  batches: Batch[]
  listings: Listing[]
  orders: Order[]
  retirements: Retirement[]
  activity: Activity[]
  account: Account | null
}

export interface TxResult {
  hash: string
  id?: number
  passed?: boolean
}

export interface Api {
  mode: Mode
  snapshot(): Promise<Snapshot>
  recordDelivery(collector: string, kg: number, origin: string): Promise<TxResult>
  createBatch(deliveryIds: number[], blocks: number, mix: string): Promise<TxResult>
  certifyBatch(
    batchId: number,
    strengthMpa: number,
    absorptionPct: number,
    thermalCycles: number,
    reportHash: string,
  ): Promise<TxResult>
  list(batchId: number, qty: number, pricePerBlock: number): Promise<TxResult>
  delist(listingId: number): Promise<TxResult>
  buy(listingId: number, qty: number): Promise<TxResult>
  ship(orderId: number): Promise<TxResult>
  confirm(orderId: number): Promise<TxResult>
  claim(orderId: number): Promise<TxResult>
  cancel(orderId: number): Promise<TxResult>
  retire(amount: number, beneficiary: string): Promise<TxResult>
}
