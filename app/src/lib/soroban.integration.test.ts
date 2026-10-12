// End-to-end test of the app's Stellar layer against a real network.
//
// Runs only when ESCOMBLOCK_IT=1. Expects a network deployed with
// `scripts/deploy.sh local --seed` (app/.env.local) and the seed accounts'
// secrets in PLANT_SECRET, LAB_SECRET and BUILDER_SECRET. See `npm run test:it`.
//
// Freighter is replaced by a signer that holds the test keys, so every write
// goes through the same code the browser uses.
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NETWORK } from './config'
import { SorobanApi } from './soroban'

const keys = new Map<string, Keypair>()

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: async (xdr: string, opts?: { address?: string }) => {
    const kp = keys.get(opts?.address ?? '')
    if (!kp) return { signedTxXdr: '', signerAddress: '', error: { message: 'User declined' } }
    const tx = TransactionBuilder.fromXDR(xdr, NETWORK.passphrase)
    tx.sign(kp)
    return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() }
  },
}))

const run = process.env.ESCOMBLOCK_IT === '1'
const friendbot = (process.env.FRIENDBOT_URL ?? 'http://localhost:8000/friendbot') + '?addr='

function load(secret: string | undefined): Keypair {
  if (!secret) throw new Error('missing secret env var')
  const kp = Keypair.fromSecret(secret)
  keys.set(kp.publicKey(), kp)
  return kp
}

async function fresh(): Promise<Keypair> {
  const kp = Keypair.random()
  keys.set(kp.publicKey(), kp)
  const res = await fetch(friendbot + kp.publicKey())
  if (!res.ok) throw new Error(`friendbot ${res.status}`)
  return kp
}

const hash = 'ab'.repeat(32)

describe.runIf(run)('SorobanApi against a live network', () => {
  let plant: SorobanApi, lab: SorobanApi, builder: SorobanApi, collector: SorobanApi
  let collectorKey: Keypair

  beforeAll(async () => {
    plant = new SorobanApi(load(process.env.PLANT_SECRET).publicKey())
    lab = new SorobanApi(load(process.env.LAB_SECRET).publicKey())
    builder = new SorobanApi(load(process.env.BUILDER_SECRET).publicKey())
    collectorKey = await fresh()
    collector = new SorobanApi(collectorKey.publicKey())
  }, 60_000)

  it('reads the public state without a wallet', async () => {
    const snap = await new SorobanApi(null).snapshot()
    expect(snap.account).toBeNull()
    expect(snap.stats.deliveries).toBeGreaterThan(0)
    expect(snap.batches[0].certification?.passed).toBe(true)
    expect(snap.config.standard.minStrengthMpa).toBe(3.5)
  }, 60_000)

  it('a new collector activates USDC from the app', async () => {
    let snap = await collector.snapshot()
    expect(snap.account?.funded).toBe(true)
    expect(snap.account?.trust.usdc).toBe(false)
    await collector.trust('usdc')
    snap = await collector.snapshot()
    expect(snap.account?.trust.usdc).toBe(true)
    expect(snap.account?.roles).toEqual([])
  }, 60_000)

  it('rejects writes from accounts without the role, with a readable message', async () => {
    await expect(collector.recordDelivery(collectorKey.publicKey(), 10, 'x')).rejects.toThrow(
      'Tu cuenta no está registrada como planta.',
    )
  }, 60_000)

  it('a visitor self-registers as plant, gets test USDC and pays a collector', async () => {
    const visitorKey = await fresh()
    const visitor = new SorobanApi(visitorKey.publicKey())
    let snap = await visitor.snapshot()
    expect(snap.config.openRoles).toBe(true)
    expect(snap.account?.roles).toEqual([])

    await visitor.join('Plant')
    await visitor.trust('usdc')
    await visitor.claimUsdc()
    snap = await visitor.snapshot()
    expect(snap.account?.roles).toEqual(['Plant'])
    expect(snap.account?.usdc).toBe(1000)
    await expect(visitor.claimUsdc()).rejects.toThrow('Ya pediste USDC de prueba hace menos de una hora.')

    const d = await visitor.recordDelivery(collectorKey.publicKey(), 1000, 'Visitante')
    expect(d.id).toBeGreaterThan(0)
  }, 120_000)

  it('runs the whole flow: pay, batch, certify, sell, deliver, retire', async () => {
    const before = await plant.snapshot()
    const collectorBefore = (await collector.snapshot()).account?.usdc ?? 0

    const d = await plant.recordDelivery(collectorKey.publicKey(), 2500, 'Prueba de integración')
    expect(d.hash).toMatch(/^[0-9a-f]{64}$/)
    const afterPay = await collector.snapshot()
    expect(afterPay.account?.usdc).toBeCloseTo(collectorBefore + 2500 * before.config.pricePerKg, 7)

    const b = await plant.createBatch([d.id!], 500, 'IT mix')
    const c = await lab.certifyBatch(b.id!, 4.8, 10.2, 60, hash)
    expect(c.passed).toBe(true)

    const l = await plant.list(b.id!, 500, 0.8)
    const o = await builder.buy(l.id!, 100)
    await plant.ship(o.id!)
    await builder.confirm(o.id!)

    const mid = await builder.snapshot()
    const order = mid.orders.find((x) => x.id === o.id)
    expect(order?.status).toBe('Completed')
    expect(order?.credits).toBeCloseTo(500, 5) // 2 500 kg / 500 blocks * 100 blocks

    await builder.retire(500, 'Prueba de integración')
    const after = await builder.snapshot()
    expect(after.stats.deliveries).toBe(before.stats.deliveries + 1)
    expect(after.stats.creditsRetired).toBeCloseTo(before.stats.creditsRetired + 500, 5)
    expect(after.batches.find((x) => x.id === b.id)?.status).toBe('Certified')
    expect(after.activity.length).toBeGreaterThan(0)
  }, 180_000)
})
