// In-browser simulation of the Escomblock contracts.
//
// Mirrors the rules of contracts/escomblock and contracts/market so the whole
// flow can be explored without a wallet or network: same roles, same checks,
// same payouts and credit math. Live mode (soroban.ts) talks to the real
// contracts on Stellar testnet instead.
import type {
  Account,
  Activity,
  Api,
  Batch,
  Config,
  Delivery,
  Listing,
  Order,
  Retirement,
  Role,
  Snapshot,
  Stats,
  TxResult,
} from './types'

export interface DemoActor {
  key: string
  name: string
  blurb: string
  address: string
  roles: Role[]
}

export const ACTORS: DemoActor[] = [
  {
    key: 'plant',
    name: 'Planta Escomblock Hermosillo',
    blurb: 'Recibe escombro, paga al instante y fabrica bloques',
    address: 'GAB2ZMZR7VIKADMJGCDTS6G7UDFVGKAUEITJX5W55X5YLVKCYDZEX7FC',
    roles: ['Plant'],
  },
  {
    key: 'lab',
    name: 'Laboratorio de Materiales',
    blurb: 'Ensaya cada lote: resistencia, absorción y ciclos de calor-humedad',
    address: 'GAKM77ONYSHNZJYV2XIQWLKXJ5OX6EZX6ASQPM2MN4VNSIM6DNGVWIYL',
    roles: ['Lab'],
  },
  {
    key: 'builder',
    name: 'Constructora del Desierto',
    blurb: 'Compra bloques certificados y retira su impacto',
    address: 'GC3IYYTQ6YPNQ2KB7JKB77RGUELGP4TAPOCLZOK2NHLTNIWAPY5MDCFX',
    roles: [],
  },
  {
    key: 'lupita',
    name: 'Guadalupe R. · recolectora',
    blurb: 'Lleva escombro de demoliciones y cobra en USDC',
    address: 'GB6WYKNEKDGKAEHXESIKZLOFAAQT2V5CD7QIRLGJFLLSFIN6U4IB2MUD',
    roles: [],
  },
]

export const COLLECTORS = [
  { name: 'Guadalupe R.', address: 'GB6WYKNEKDGKAEHXESIKZLOFAAQT2V5CD7QIRLGJFLLSFIN6U4IB2MUD' },
  { name: 'Ramón V.', address: 'GCVQ4HQKICTZYHL4YWYI46POT2IAY3KGNAWSEUJ4RTLSUME2OXRLVMUB' },
  { name: 'Candelaria M.', address: 'GAM6EFOBB4C6ITQEUIE652E7E4ZOWBCPZKTGV7GZXKC5TVLUPLMIB4DE' },
  { name: 'Alberto S.', address: 'GAZ2HYMWGEM6QRM5GN3JCXW37MLEZ44LN45E54MV7XPROYXIU65ZOYX3' },
]

const ADMIN = 'GADZAN3K72UUWOHLNEO3H65UP37BFHIYCTHYIPNDJ6ZHNB7OC2WS3KXA'
const TREASURY = ADMIN

export function nameOf(address: string): string {
  return (
    ACTORS.find((a) => a.address === address)?.name ??
    COLLECTORS.find((c) => c.address === address)?.name ??
    ''
  )
}

interface State {
  version: number
  actor: string
  now: number
  config: Config
  stats: Stats
  deliveries: Delivery[]
  batches: Batch[]
  listings: Listing[]
  orders: Order[]
  retirements: Retirement[]
  activity: Activity[]
  usdc: Record<string, number>
  escb: Record<string, number>
  /** Blocks of each batch currently listed or sold (market `Listed` key). */
  listed: Record<number, number>
}

const STORAGE_KEY = 'escomblock-demo-v2'
const VERSION = 2
const DAY = 86_400

const [PLANT, LAB, BUILDER] = ACTORS.map((a) => a.address)

class DemoError extends Error {}
const fail = (msg: string): never => {
  throw new DemoError(msg)
}

function randomHash(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7

function freshState(): State {
  const t0 = Math.floor(new Date('2026-09-14T15:00:00Z').getTime() / 1000)
  const s: State = {
    version: VERSION,
    actor: 'plant',
    now: t0,
    config: {
      admin: ADMIN,
      pricePerKg: 0.004,
      standard: { minStrengthMpa: 3.5, maxAbsorptionPct: 12, minThermalCycles: 50 },
      feeBps: 200,
      claimAfterDays: 7,
    },
    stats: {
      deliveries: 0,
      rubbleKg: 0,
      usdcPaid: 0,
      batches: 0,
      certifiedBatches: 0,
      certifiedBlocks: 0,
      creditsMinted: 0,
      creditsRetired: 0,
      retirements: 0,
    },
    deliveries: [],
    batches: [],
    listings: [],
    orders: [],
    retirements: [],
    activity: [],
    usdc: { [PLANT]: 2_500, [BUILDER]: 8_000 },
    escb: {},
    listed: {},
  }
  const sim = new DemoEngine(s)
  const at = (days: number, hours = 0) => {
    s.now = t0 + days * DAY + hours * 3600
  }
  const [lupita, ramon, cande, beto] = COLLECTORS.map((c) => c.address)

  // Batch 1: certified, sold in part, impact partially retired.
  at(0, 1)
  sim.as(PLANT).recordDelivery(lupita, 6_200, 'Demolición vivienda, Col. Centro')
  at(0, 5)
  sim.as(PLANT).recordDelivery(ramon, 4_800, 'Remodelación local, Blvd. Kino')
  at(1, 2)
  sim.as(PLANT).recordDelivery(cande, 5_400, 'Banquetas retiradas, Col. Pitic')
  at(2, 3)
  sim.as(PLANT).recordDelivery(lupita, 3_600, 'Barda caída, Col. Modelo')
  at(3)
  sim.as(PLANT).createBatch([1, 2, 3, 4], 4_000, '40 % escombro triturado + CPC 30R + arena')
  at(10)
  sim.as(LAB).certifyBatch(1, 5.2, 9.8, 60, randomHash())
  at(10, 4)
  sim.as(PLANT).list(1, 3_000, 0.75)
  at(12)
  sim.as(BUILDER).buy(1, 1_200)
  at(13)
  sim.as(PLANT).ship(1)
  at(15)
  sim.as(BUILDER).confirm(1)
  at(16)
  sim.as(BUILDER).retire(4_000, 'Torre Pitic, etapa 1 (demo)')

  // Batch 2: rejected by the lab (too weak, absorbs too much water).
  at(17)
  sim.as(PLANT).recordDelivery(beto, 5_000, 'Escombro mixto con yeso, Col. San Benito')
  at(17, 6)
  sim.as(PLANT).recordDelivery(ramon, 3_000, 'Losa demolida, Col. Balderrama')
  at(18)
  sim.as(PLANT).createBatch([5, 6], 1_600, '60 % escombro sin cribar + CPC 30R')
  at(24)
  sim.as(LAB).certifyBatch(2, 2.9, 14.6, 60, randomHash())

  // Batch 3: waiting for the lab (try certifying it as the lab).
  at(25)
  sim.as(PLANT).recordDelivery(cande, 7_000, 'Demolición escuela, Col. Olivares')
  at(25, 3)
  sim.as(PLANT).recordDelivery(lupita, 4_500, 'Guarniciones, Blvd. Solidaridad')
  at(26)
  sim.as(PLANT).createBatch([7, 8], 2_300, '40 % escombro cribado #4 + CPC 30R + arena')

  // Fresh deliveries, not batched yet (try creating a batch as the plant).
  at(27, 2)
  sim.as(PLANT).recordDelivery(beto, 3_900, 'Remodelación baño y cocina, Col. Las Quintas')
  at(28)
  sim.as(PLANT).recordDelivery(ramon, 5_100, 'Demolición bodega, Parque Industrial')

  s.now = Math.max(t0 + 28 * DAY, Math.floor(Date.now() / 1000))
  return s
}

class DemoEngine {
  s: State
  who = ''
  constructor(s: State) {
    this.s = s
  }
  as(address: string) {
    this.who = address
    return this
  }

  private hasRole(addr: string, role: Role) {
    return ACTORS.some((a) => a.address === addr && a.roles.includes(role))
  }
  private need(role: Role) {
    if (!this.hasRole(this.who, role))
      fail(role === 'Plant' ? 'Solo una planta registrada puede hacer esto.' : 'Solo un laboratorio registrado puede certificar.')
  }
  private move(token: 'usdc' | 'escb', from: string, to: string, amount: number) {
    const book = this.s[token]
    if ((book[from] ?? 0) + 1e-9 < amount)
      fail(`Saldo insuficiente de ${token === 'usdc' ? 'USDC' : 'ESCB'}.`)
    book[from] = round7((book[from] ?? 0) - amount)
    if (to) book[to] = round7((book[to] ?? 0) + amount)
  }
  private log(kind: Activity['kind'], text: string): string {
    const hash = randomHash()
    this.s.activity.unshift({ id: hash, kind, text, timestamp: this.s.now, txHash: hash })
    this.s.activity = this.s.activity.slice(0, 60)
    return hash
  }

  recordDelivery(collector: string, kg: number, origin: string): TxResult {
    this.need('Plant')
    if (!(kg > 0) || !Number.isInteger(kg)) fail('Indica los kilos como número entero mayor que cero.')
    if (collector === this.who) fail('La planta no puede pagarse a sí misma.')
    if (!/^G[A-Z2-7]{55}$/.test(collector)) fail('La dirección del recolector no es una cuenta Stellar válida (G…).')
    const payout = round7(kg * this.s.config.pricePerKg)
    this.move('usdc', this.who, collector, payout)
    const id = this.s.deliveries.length + 1
    this.s.deliveries.push({
      id,
      plant: this.who,
      collector,
      kg,
      origin,
      payout,
      timestamp: this.s.now,
      batchId: 0,
    })
    const st = this.s.stats
    st.deliveries++
    st.rubbleKg += kg
    st.usdcPaid = round7(st.usdcPaid + payout)
    const who = nameOf(collector) || collector.slice(0, 6)
    return { id, hash: this.log('delivery', `Entrega #${id}: ${kg.toLocaleString('es-MX')} kg de ${who}, pagado ${payout.toFixed(2)} USDC`) }
  }

  createBatch(ids: number[], blocks: number, mix: string): TxResult {
    this.need('Plant')
    if (!ids.length || !(blocks > 0)) fail('Elige entregas y el número de bloques.')
    if (ids.length > 50) fail('Máximo 50 entregas por lote.')
    const id = this.s.batches.length + 1
    let kg = 0
    for (const did of ids) {
      const d = this.s.deliveries[did - 1] ?? fail(`La entrega #${did} no existe.`)
      if (d.plant !== this.who) fail(`La entrega #${did} es de otra planta.`)
      if (d.batchId) fail(`La entrega #${did} ya se usó en el lote #${d.batchId}.`)
    }
    for (const did of ids) {
      const d = this.s.deliveries[did - 1]
      d.batchId = id
      kg += d.kg
    }
    this.s.batches.push({
      id,
      plant: this.who,
      deliveries: [...ids],
      rubbleKg: kg,
      blocks,
      mix,
      status: 'Pending',
      createdAt: this.s.now,
      creditsMinted: 0,
    })
    this.s.stats.batches++
    return { id, hash: this.log('batch', `Lote #${id}: ${blocks.toLocaleString('es-MX')} bloques con ${kg.toLocaleString('es-MX')} kg de escombro`) }
  }

  certifyBatch(batchId: number, strength: number, absorption: number, cycles: number, reportHash: string): TxResult {
    this.need('Lab')
    const b = this.s.batches[batchId - 1] ?? fail(`El lote #${batchId} no existe.`)
    if (b.status !== 'Pending') fail('Este lote ya fue evaluado.')
    if (b.plant === this.who) fail('Una planta no puede certificar sus propios bloques.')
    const std = this.s.config.standard
    const passed =
      strength >= std.minStrengthMpa && absorption <= std.maxAbsorptionPct && cycles >= std.minThermalCycles
    b.certification = {
      lab: this.who,
      strengthMpa: strength,
      absorptionPct: absorption,
      thermalCycles: cycles,
      reportHash,
      passed,
      timestamp: this.s.now,
    }
    if (passed) {
      b.status = 'Certified'
      b.creditsMinted = b.rubbleKg
      this.s.escb[b.plant] = (this.s.escb[b.plant] ?? 0) + b.rubbleKg
      const st = this.s.stats
      st.certifiedBatches++
      st.certifiedBlocks += b.blocks
      st.creditsMinted += b.rubbleKg
    } else {
      b.status = 'Rejected'
    }
    const text = passed
      ? `Lote #${batchId} certificado (${strength.toFixed(2)} MPa). Emitidos ${b.rubbleKg.toLocaleString('es-MX')} ESCB`
      : `Lote #${batchId} rechazado por el laboratorio (${strength.toFixed(2)} MPa, ${absorption.toFixed(1)} % absorción)`
    return { id: batchId, passed, hash: this.log('certify', text) }
  }

  list(batchId: number, qty: number, price: number): TxResult {
    const b = this.s.batches[batchId - 1] ?? fail(`El lote #${batchId} no existe.`)
    if (b.status !== 'Certified') fail('Solo se pueden vender lotes certificados.')
    if (b.plant !== this.who) fail('Solo la planta dueña del lote puede venderlo.')
    if (!(qty > 0) || !(price > 0)) fail('Cantidad y precio deben ser mayores que cero.')
    const listed = this.s.listed[batchId] ?? 0
    if (listed + qty > b.blocks) fail(`Quedan ${b.blocks - listed} bloques sin publicar en este lote.`)
    this.s.listed[batchId] = listed + qty
    const cpb = b.rubbleKg / b.blocks
    this.move('escb', this.who, 'market', round7(cpb * qty))
    const id = this.s.listings.length + 1
    this.s.listings.push({
      id,
      seller: this.who,
      batchId,
      pricePerBlock: price,
      creditsPerBlock: cpb,
      available: qty,
      sold: 0,
      active: true,
    })
    return { id, hash: this.log('list', `Publicación #${id}: ${qty.toLocaleString('es-MX')} bloques del lote #${batchId} a ${price.toFixed(2)} USDC c/u`) }
  }

  delist(listingId: number): TxResult {
    const l = this.s.listings[listingId - 1] ?? fail('La publicación no existe.')
    if (l.seller !== this.who) fail('Solo quien publicó puede retirar la publicación.')
    if (!l.active) fail('La publicación ya está cerrada.')
    this.move('escb', 'market', this.who, round7(l.creditsPerBlock * l.available))
    this.s.listed[l.batchId] -= l.available
    l.available = 0
    l.active = false
    return { id: listingId, hash: this.log('list', `Publicación #${listingId} cerrada`) }
  }

  buy(listingId: number, qty: number): TxResult {
    const l = this.s.listings[listingId - 1] ?? fail('La publicación no existe.')
    if (!l.active) fail('La publicación está cerrada.')
    if (l.seller === this.who) fail('No puedes comprar tus propios bloques.')
    if (!(qty > 0) || !Number.isInteger(qty)) fail('Indica una cantidad entera de bloques.')
    if (qty > l.available) fail(`Solo hay ${l.available} bloques disponibles.`)
    const total = round7(l.pricePerBlock * qty)
    this.move('usdc', this.who, 'market', total)
    l.available -= qty
    l.sold += qty
    const id = this.s.orders.length + 1
    this.s.orders.push({
      id,
      listingId,
      buyer: this.who,
      seller: l.seller,
      qty,
      total,
      credits: round7(l.creditsPerBlock * qty),
      status: 'Paid',
      createdAt: this.s.now,
      shippedAt: 0,
    })
    return { id, hash: this.log('order', `Pedido #${id}: ${qty.toLocaleString('es-MX')} bloques, ${total.toFixed(2)} USDC en garantía`) }
  }

  ship(orderId: number): TxResult {
    const o = this.s.orders[orderId - 1] ?? fail('El pedido no existe.')
    if (o.seller !== this.who) fail('Solo el vendedor marca el envío.')
    if (o.status !== 'Paid') fail('El pedido no está pendiente de envío.')
    o.status = 'Shipped'
    o.shippedAt = this.s.now
    return { id: orderId, hash: this.log('order', `Pedido #${orderId} enviado`) }
  }

  private settle(o: Order) {
    const fee = round7((o.total * this.s.config.feeBps) / 10_000)
    this.move('usdc', 'market', TREASURY, fee)
    this.move('usdc', 'market', o.seller, round7(o.total - fee))
    this.move('escb', 'market', o.buyer, o.credits)
    o.status = 'Completed'
  }

  confirm(orderId: number): TxResult {
    const o = this.s.orders[orderId - 1] ?? fail('El pedido no existe.')
    if (o.buyer !== this.who) fail('Solo el comprador confirma la recepción.')
    if (o.status !== 'Paid' && o.status !== 'Shipped') fail('El pedido ya se cerró.')
    this.settle(o)
    return { id: orderId, hash: this.log('order', `Pedido #${orderId} recibido: pago liberado y ${Math.round(o.credits).toLocaleString('es-MX')} ESCB al comprador`) }
  }

  claim(orderId: number): TxResult {
    const o = this.s.orders[orderId - 1] ?? fail('El pedido no existe.')
    if (o.seller !== this.who) fail('Solo el vendedor puede reclamar.')
    if (o.status !== 'Shipped') fail('El pedido no está enviado.')
    if (this.s.now < o.shippedAt + this.s.config.claimAfterDays * DAY)
      fail(`Podrás reclamar ${this.s.config.claimAfterDays} días después del envío.`)
    this.settle(o)
    return { id: orderId, hash: this.log('order', `Pedido #${orderId} liquidado por plazo vencido`) }
  }

  cancel(orderId: number): TxResult {
    const o = this.s.orders[orderId - 1] ?? fail('El pedido no existe.')
    if (o.buyer !== this.who) fail('Solo el comprador puede cancelar.')
    if (o.status !== 'Paid') fail('Solo se cancela antes del envío.')
    this.move('usdc', 'market', o.buyer, o.total)
    const l = this.s.listings[o.listingId - 1]
    l.sold -= o.qty
    if (l.active) l.available += o.qty
    else {
      this.move('escb', 'market', o.seller, o.credits)
      this.s.listed[l.batchId] -= o.qty
    }
    o.status = 'Cancelled'
    return { id: orderId, hash: this.log('order', `Pedido #${orderId} cancelado y reembolsado`) }
  }

  retire(amount: number, beneficiary: string): TxResult {
    if (!(amount > 0)) fail('Indica cuántos ESCB retirar.')
    this.move('escb', this.who, '', amount)
    const id = this.s.retirements.length + 1
    this.s.retirements.push({ id, by: this.who, amount, beneficiary, timestamp: this.s.now })
    this.s.stats.creditsRetired += amount
    this.s.stats.retirements++
    return { id, hash: this.log('retire', `Retiro #${id}: ${amount.toLocaleString('es-MX')} ESCB a nombre de “${beneficiary}”`) }
  }
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as State
      if (s.version === VERSION) return s
    }
  } catch {
    // storage unavailable: start fresh
  }
  return freshState()
}

export class DemoApi implements Api {
  mode = 'demo' as const
  private state: State = load()

  get actor(): DemoActor {
    return ACTORS.find((a) => a.key === this.state.actor) ?? ACTORS[0]
  }
  setActor(key: string) {
    this.state.actor = key
    this.save()
  }
  reset() {
    this.state = freshState()
    this.save()
  }
  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // ignore
    }
  }

  private run(fn: (e: DemoEngine) => TxResult): Promise<TxResult> {
    // Work on a copy so a failed call leaves no partial changes, like a
    // reverted transaction.
    const draft: State = structuredClone(this.state)
    draft.now = Math.max(draft.now + 60, Math.floor(Date.now() / 1000))
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const res = fn(new DemoEngine(draft).as(this.actor.address))
          this.state = draft
          this.save()
          resolve(res)
        } catch (err) {
          reject(err)
        }
      }, 450)
    })
  }

  async snapshot(): Promise<Snapshot> {
    const s = this.state
    const a = this.actor
    const account: Account = {
      address: a.address,
      name: a.name,
      roles: a.roles,
      usdc: s.usdc[a.address] ?? 0,
      escb: s.escb[a.address] ?? 0,
    }
    return structuredClone({
      config: s.config,
      stats: s.stats,
      deliveries: s.deliveries,
      batches: s.batches,
      listings: s.listings,
      orders: s.orders,
      retirements: s.retirements,
      activity: s.activity,
      account,
    })
  }

  recordDelivery(c: string, kg: number, o: string) {
    return this.run((e) => e.recordDelivery(c, kg, o))
  }
  createBatch(ids: number[], blocks: number, mix: string) {
    return this.run((e) => e.createBatch(ids, blocks, mix))
  }
  certifyBatch(id: number, s: number, a: number, c: number, h: string) {
    return this.run((e) => e.certifyBatch(id, s, a, c, h))
  }
  list(b: number, q: number, p: number) {
    return this.run((e) => e.list(b, q, p))
  }
  delist(id: number) {
    return this.run((e) => e.delist(id))
  }
  buy(id: number, q: number) {
    return this.run((e) => e.buy(id, q))
  }
  ship(id: number) {
    return this.run((e) => e.ship(id))
  }
  confirm(id: number) {
    return this.run((e) => e.confirm(id))
  }
  claim(id: number) {
    return this.run((e) => e.claim(id))
  }
  cancel(id: number) {
    return this.run((e) => e.cancel(id))
  }
  retire(amount: number, beneficiary: string) {
    return this.run((e) => e.retire(amount, beneficiary))
  }
}
