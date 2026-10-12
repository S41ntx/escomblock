// Talks to the deployed Escomblock contracts through Soroban RPC and signs
// with the Freighter wallet. Reads need no wallet (simulation only).
import { Asset, BASE_FEE, Operation, TransactionBuilder, contract, rpc } from '@stellar/stellar-sdk'
import * as freighter from '@stellar/freighter-api'
import { ASSETS, CONTRACTS, NETWORK } from './config'
import type {
  Account,
  Activity,
  Batch,
  BatchStatus,
  Certification,
  Config,
  Delivery,
  Listing,
  Order,
  OrderStatus,
  Retirement,
  Role,
  Snapshot,
  Stats,
  TxResult,
} from './types'

const UNIT = 10_000_000
/** Records per collection shown in the app; one RPC call each (contract max 50). */
const PAGE = 50

type Dyn = any

const toNum = (v: bigint | number | string | undefined) => Number(v ?? 0)
const toAmount = (v: bigint | number | string | undefined) => Number(v ?? 0) / UNIT
const toStroops = (n: number) => BigInt(Math.round(n * UNIT))
const tag = (v: Dyn): string => (typeof v === 'string' ? v : v?.tag)
const hex = (b: Dyn): string =>
  b ? [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('') : ''
const lastPage = (n: number) => Math.max(1, n - PAGE + 1)

const CORE_ERRORS: Record<number, string> = {
  1: 'Tu cuenta no está registrada como planta.',
  2: 'Tu cuenta no está registrada como laboratorio.',
  3: 'La cantidad debe ser mayor que cero.',
  4: 'Esa entrega no existe.',
  5: 'Una de las entregas ya se usó en otro lote.',
  6: 'Una de las entregas pertenece a otra planta.',
  7: 'Ese lote no existe.',
  8: 'Ese lote ya fue evaluado.',
  9: 'Una planta no puede certificar sus propios bloques.',
  10: 'Máximo 50 entregas por lote.',
  11: 'Ese retiro no existe.',
  12: 'Parámetros inválidos (¿el recolector es la misma planta?).',
  13: 'El registro está en pausa por mantenimiento.',
}
const MARKET_ERRORS: Record<number, string> = {
  1: 'Solo se pueden vender lotes certificados.',
  2: 'Solo la planta dueña del lote puede venderlo.',
  3: 'Cantidad y precio deben ser mayores que cero.',
  4: 'No hay suficientes bloques disponibles.',
  5: 'Esa publicación no existe.',
  6: 'La publicación está cerrada.',
  7: 'Ese pedido no existe.',
  8: 'Solo el comprador puede hacer esto.',
  9: 'Solo el vendedor puede hacer esto.',
  10: 'El pedido no está en el estado correcto.',
  11: 'Aún no vence el plazo para reclamar.',
  12: 'Parámetros inválidos.',
  13: 'No puedes comprar tus propios bloques.',
  14: 'El mercado está en pausa por mantenimiento.',
}

function explain(err: unknown, table: Record<number, string>): Error {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/Error\(Contract, #(\d+)\)/)
  if (m && table[Number(m[1])]) return new Error(table[Number(m[1])])
  if (/trustline|TrustLine|#13\b.*balance|missing.*trust/i.test(msg))
    return new Error('Una de las cuentas no tiene activado el activo (trustline). Actívalo desde la barra de wallet.')
  if (/insufficient|resulting balance|BalanceError/i.test(msg))
    return new Error('Saldo insuficiente.')
  if (/User declined|rejected|denied/i.test(msg)) return new Error('Firma cancelada en la wallet.')
  if (/Account not found/i.test(msg))
    return new Error('Tu cuenta aún no existe en la red: deposítale algunos XLM primero.')
  return new Error(msg.split('\n')[0].slice(0, 220))
}

export async function connectFreighter(): Promise<string> {
  const conn = await freighter.isConnected()
  if (!conn.isConnected) throw new Error('Instala la extensión Freighter (freighter.app) para firmar.')
  const access = await freighter.requestAccess()
  if (access.error) throw new Error(access.error.message ?? 'Freighter rechazó la conexión.')
  const net = await freighter.getNetworkDetails()
  if (!net.error && net.networkPassphrase && net.networkPassphrase !== NETWORK.passphrase)
    throw new Error(`Cambia Freighter a la red ${NETWORK.name === 'mainnet' ? 'Mainnet (Public)' : 'Testnet'}.`)
  return access.address
}

export class SorobanApi {
  network = NETWORK.name
  address: string | null
  private server = new rpc.Server(NETWORK.rpcUrl, { allowHttp: NETWORK.rpcUrl.startsWith('http://') })
  private clients: Record<string, Promise<Dyn>> = {}
  private session: Activity[] = []

  constructor(address: string | null) {
    this.address = address
  }

  private client(id: string): Promise<Dyn> {
    if (!this.clients[id]) {
      this.clients[id] = contract.Client.from({
        contractId: id,
        rpcUrl: NETWORK.rpcUrl,
        allowHttp: NETWORK.rpcUrl.startsWith('http://'),
        networkPassphrase: NETWORK.passphrase,
        publicKey: this.address ?? undefined,
        signTransaction: (xdr: string, opts?: Dyn) =>
          freighter.signTransaction(xdr, {
            networkPassphrase: NETWORK.passphrase,
            address: opts?.address ?? this.address ?? undefined,
          }),
      })
    }
    return this.clients[id]
  }

  private async read<T>(id: string, method: string, args: Dyn = {}): Promise<T> {
    const c = await this.client(id)
    const tx = await c[method](args)
    return tx.result as T
  }

  private log(kind: Activity['kind'], text: string, hash: string) {
    this.session.unshift({
      id: hash || String(Date.now()),
      kind,
      text,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: hash,
    })
  }

  private async write(
    id: string,
    method: string,
    args: Dyn,
    describe: (result: Dyn) => { text: string; kind: Activity['kind']; id?: number; passed?: boolean },
  ): Promise<TxResult> {
    if (!this.address) throw new Error('Conecta tu wallet Freighter primero.')
    const table = id === CONTRACTS.market ? MARKET_ERRORS : CORE_ERRORS
    try {
      const c = await this.client(id)
      const tx = await c[method](args)
      const sent = await tx.signAndSend()
      const hash: string =
        sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? ''
      const d = describe(sent.result)
      this.log(d.kind, d.text, hash)
      return { hash, id: d.id, passed: d.passed }
    } catch (err) {
      throw explain(err, table)
    }
  }

  // ------------------------------------------------------------ wallet

  /** Adds a trustline so the connected account can hold `which`. */
  async trust(which: 'usdc' | 'escb'): Promise<TxResult> {
    const asset: Asset | null = ASSETS[which]
    if (!this.address || !asset) throw new Error('Conecta tu wallet Freighter primero.')
    try {
      const account = await this.server.getAccount(this.address)
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(180)
        .build()
      const signed = await freighter.signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK.passphrase,
        address: this.address,
      })
      if (signed.error) throw new Error(signed.error.message ?? 'Firma cancelada en la wallet.')
      const ready = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK.passphrase)
      const sent = await this.server.sendTransaction(ready)
      if (sent.status === 'ERROR') throw new Error('La red rechazó la transacción.')
      const done = await this.server.pollTransaction(sent.hash, { attempts: 30 })
      if (done.status !== 'SUCCESS') throw new Error('La transacción no se confirmó.')
      this.log('info', `${asset.getCode()} activado en tu wallet`, sent.hash)
      return { hash: sent.hash }
    } catch (err) {
      throw explain(err, CORE_ERRORS)
    }
  }

  private async balance(asset: Asset | null, address: string): Promise<{ amount: number; trusted: boolean }> {
    if (!asset) return { amount: 0, trusted: false }
    try {
      const res = await this.server.getAssetBalance(address, asset, NETWORK.passphrase)
      return { amount: toAmount(res.balanceEntry?.amount), trusted: Boolean(res.balanceEntry) }
    } catch {
      return { amount: 0, trusted: false }
    }
  }

  // ------------------------------------------------------------ snapshot

  async snapshot(): Promise<Snapshot> {
    const core = CONTRACTS.core
    const market = CONTRACTS.market
    const [rawCfg, rawStats, counts, mcfg, mcounts, corePaused, marketPaused] = await Promise.all([
      this.read<Dyn>(core, 'config'),
      this.read<Dyn>(core, 'stats'),
      this.read<[bigint, bigint, bigint]>(core, 'counts'),
      this.read<Dyn>(market, 'config'),
      this.read<[bigint, bigint]>(market, 'counts'),
      this.read<boolean>(core, 'paused'),
      this.read<boolean>(market, 'paused'),
    ])
    const [nDel, nBatch, nRet] = counts.map(toNum)
    const [nList, nOrd] = mcounts.map(toNum)
    const pageArgs = (n: number) => ({ start: BigInt(lastPage(n)), limit: PAGE })
    const none = Promise.resolve([] as Dyn[])

    const [rawDeliveries, rawBatches, rawListings, rawOrders, rawRetirements] = await Promise.all([
      nDel ? this.read<Dyn[]>(core, 'deliveries', pageArgs(nDel)) : none,
      nBatch ? this.read<Dyn[]>(core, 'batches', pageArgs(nBatch)) : none,
      nList ? this.read<Dyn[]>(market, 'listings', pageArgs(nList)) : none,
      nOrd ? this.read<Dyn[]>(market, 'orders', pageArgs(nOrd)) : none,
      nRet ? this.read<Dyn[]>(core, 'retirements', pageArgs(nRet)) : none,
    ])
    const deliveries = rawDeliveries.map(mapDelivery)
    const batches = rawBatches.map((v) => mapBatch(v.batch, v.certification?.[0]))
    const listings = rawListings.map(mapListing)
    const orders = rawOrders.map(mapOrder)
    const retirements = rawRetirements.map(mapRetirement)

    let account: Account | null = null
    if (this.address) {
      const a = this.address
      const [usdc, escb, isPlant, isLab, funded] = await Promise.all([
        this.balance(ASSETS.usdc, a),
        this.balance(ASSETS.escb, a),
        this.read<boolean>(core, 'has_role', { account: a, role: { tag: 'Plant', values: undefined } }),
        this.read<boolean>(core, 'has_role', { account: a, role: { tag: 'Lab', values: undefined } }),
        this.server.getAccount(a).then(
          () => true,
          () => false,
        ),
      ])
      const roles: Role[] = []
      if (isPlant) roles.push('Plant')
      if (isLab) roles.push('Lab')
      account = {
        address: a,
        roles,
        funded,
        usdc: usdc.amount,
        escb: escb.amount,
        trust: { usdc: usdc.trusted, escb: escb.trusted },
      }
    }

    const config: Config = {
      admin: rawCfg.admin,
      pricePerKg: toAmount(rawCfg.price_per_kg),
      standard: {
        minStrengthMpa: toNum(rawCfg.standard.min_strength_mpa_x100) / 100,
        maxAbsorptionPct: toNum(rawCfg.standard.max_absorption_pct_x100) / 100,
        minThermalCycles: toNum(rawCfg.standard.min_thermal_cycles),
      },
      feeBps: toNum(mcfg.fee_bps),
      claimAfterDays: toNum(mcfg.claim_after) / 86_400,
      corePaused,
      marketPaused,
    }
    const stats: Stats = {
      deliveries: toNum(rawStats.deliveries),
      rubbleKg: toNum(rawStats.rubble_kg),
      usdcPaid: toAmount(rawStats.usdc_paid),
      batches: toNum(rawStats.batches),
      certifiedBatches: toNum(rawStats.certified_batches),
      certifiedBlocks: toNum(rawStats.certified_blocks),
      creditsMinted: toAmount(rawStats.credits_minted),
      creditsRetired: toAmount(rawStats.credits_retired),
      retirements: toNum(rawStats.retirements),
    }

    return {
      config,
      stats,
      deliveries,
      batches,
      listings,
      orders,
      retirements,
      activity: [...this.session, ...historyFrom(deliveries, batches, orders, retirements)].slice(0, 60),
      account,
    }
  }

  // ------------------------------------------------------------ writes

  recordDelivery(collector: string, kg: number, origin: string) {
    return this.write(
      CONTRACTS.core,
      'record_delivery',
      { plant: this.address, collector, kg: BigInt(kg), origin },
      (id) => ({ kind: 'delivery', id: toNum(id), text: `Entrega #${toNum(id)} registrada y pagada` }),
    )
  }
  createBatch(deliveryIds: number[], blocks: number, mix: string) {
    return this.write(
      CONTRACTS.core,
      'create_batch',
      { plant: this.address, delivery_ids: deliveryIds.map(BigInt), blocks, mix },
      (id) => ({ kind: 'batch', id: toNum(id), text: `Lote #${toNum(id)} creado` }),
    )
  }
  certifyBatch(batchId: number, strength: number, absorption: number, cycles: number, reportHash: string) {
    const bytes = new Uint8Array(reportHash.match(/../g)!.map((h) => parseInt(h, 16)))
    return this.write(
      CONTRACTS.core,
      'certify_batch',
      {
        lab: this.address,
        batch_id: BigInt(batchId),
        strength_mpa_x100: Math.round(strength * 100),
        absorption_pct_x100: Math.round(absorption * 100),
        thermal_cycles: cycles,
        report_hash: bytes,
      },
      (passed) => ({
        kind: 'certify',
        id: batchId,
        passed: Boolean(passed),
        text: passed ? `Lote #${batchId} certificado` : `Lote #${batchId} rechazado`,
      }),
    )
  }
  list(batchId: number, qty: number, price: number) {
    return this.write(
      CONTRACTS.market,
      'list',
      { seller: this.address, batch_id: BigInt(batchId), qty, price_per_block: toStroops(price) },
      (id) => ({ kind: 'list', id: toNum(id), text: `Publicación #${toNum(id)} creada` }),
    )
  }
  delist(listingId: number) {
    return this.write(CONTRACTS.market, 'delist', { seller: this.address, listing_id: BigInt(listingId) }, () => ({
      kind: 'list',
      text: `Publicación #${listingId} cerrada`,
    }))
  }
  buy(listingId: number, qty: number) {
    return this.write(
      CONTRACTS.market,
      'buy',
      { buyer: this.address, listing_id: BigInt(listingId), qty },
      (id) => ({ kind: 'order', id: toNum(id), text: `Pedido #${toNum(id)} pagado en garantía` }),
    )
  }
  ship(orderId: number) {
    return this.write(CONTRACTS.market, 'ship', { seller: this.address, order_id: BigInt(orderId) }, () => ({
      kind: 'order',
      text: `Pedido #${orderId} enviado`,
    }))
  }
  confirm(orderId: number) {
    return this.write(CONTRACTS.market, 'confirm', { buyer: this.address, order_id: BigInt(orderId) }, () => ({
      kind: 'order',
      text: `Pedido #${orderId} recibido`,
    }))
  }
  claim(orderId: number) {
    return this.write(CONTRACTS.market, 'claim', { seller: this.address, order_id: BigInt(orderId) }, () => ({
      kind: 'order',
      text: `Pedido #${orderId} liquidado`,
    }))
  }
  cancel(orderId: number) {
    return this.write(CONTRACTS.market, 'cancel', { buyer: this.address, order_id: BigInt(orderId) }, () => ({
      kind: 'order',
      text: `Pedido #${orderId} cancelado`,
    }))
  }
  retire(amount: number, beneficiary: string) {
    return this.write(
      CONTRACTS.core,
      'retire',
      { from: this.address, amount: toStroops(amount), beneficiary },
      (id) => ({ kind: 'retire', id: toNum(id), text: `Retiro #${toNum(id)}: ${amount} ESCB` }),
    )
  }
}

// ------------------------------------------------------------ mapping

function mapDelivery(d: Dyn): Delivery {
  return {
    id: toNum(d.id),
    plant: d.plant,
    collector: d.collector,
    kg: toNum(d.kg),
    origin: d.origin,
    payout: toAmount(d.payout),
    timestamp: toNum(d.timestamp),
    batchId: toNum(d.batch_id),
  }
}

function mapBatch(b: Dyn, cert: Dyn): Batch {
  const certification: Certification | undefined = cert
    ? {
        lab: cert.lab,
        strengthMpa: toNum(cert.strength_mpa_x100) / 100,
        absorptionPct: toNum(cert.absorption_pct_x100) / 100,
        thermalCycles: toNum(cert.thermal_cycles),
        reportHash: hex(cert.report_hash),
        passed: Boolean(cert.passed),
        timestamp: toNum(cert.timestamp),
      }
    : undefined
  return {
    id: toNum(b.id),
    plant: b.plant,
    deliveries: (b.deliveries as bigint[]).map(toNum),
    rubbleKg: toNum(b.rubble_kg),
    blocks: toNum(b.blocks),
    mix: b.mix,
    status: tag(b.status) as BatchStatus,
    createdAt: toNum(b.created_at),
    creditsMinted: toAmount(b.credits_minted),
    certification,
  }
}

function mapListing(l: Dyn): Listing {
  return {
    id: toNum(l.id),
    seller: l.seller,
    batchId: toNum(l.batch_id),
    pricePerBlock: toAmount(l.price_per_block),
    creditsPerBlock: toAmount(l.credits_per_block),
    available: toNum(l.available),
    sold: toNum(l.sold),
    active: Boolean(l.active),
  }
}

function mapOrder(o: Dyn): Order {
  return {
    id: toNum(o.id),
    listingId: toNum(o.listing_id),
    buyer: o.buyer,
    seller: o.seller,
    qty: toNum(o.qty),
    total: toAmount(o.total),
    credits: toAmount(o.credits),
    status: tag(o.status) as OrderStatus,
    createdAt: toNum(o.created_at),
    shippedAt: toNum(o.shipped_at),
  }
}

function mapRetirement(r: Dyn): Retirement {
  return {
    id: toNum(r.id),
    by: r.by,
    amount: toAmount(r.amount),
    beneficiary: r.beneficiary,
    timestamp: toNum(r.timestamp),
  }
}

function historyFrom(
  deliveries: Delivery[],
  batches: Batch[],
  orders: Order[],
  retirements: Retirement[],
): Activity[] {
  const items: Activity[] = []
  for (const d of deliveries)
    items.push({
      id: `d${d.id}`,
      kind: 'delivery',
      timestamp: d.timestamp,
      text: `Entrega #${d.id}: ${d.kg.toLocaleString('es-MX')} kg, pagado ${d.payout.toFixed(2)} USDC`,
    })
  for (const b of batches) {
    items.push({
      id: `b${b.id}`,
      kind: 'batch',
      timestamp: b.createdAt,
      text: `Lote #${b.id}: ${b.blocks.toLocaleString('es-MX')} bloques con ${b.rubbleKg.toLocaleString('es-MX')} kg`,
    })
    if (b.certification)
      items.push({
        id: `c${b.id}`,
        kind: 'certify',
        timestamp: b.certification.timestamp,
        text: b.certification.passed
          ? `Lote #${b.id} certificado, ${b.creditsMinted.toLocaleString('es-MX')} ESCB emitidos`
          : `Lote #${b.id} rechazado por el laboratorio`,
      })
  }
  for (const o of orders)
    items.push({
      id: `o${o.id}`,
      kind: 'order',
      timestamp: o.createdAt,
      text: `Pedido #${o.id}: ${o.qty.toLocaleString('es-MX')} bloques (${o.status})`,
    })
  for (const r of retirements)
    items.push({
      id: `r${r.id}`,
      kind: 'retire',
      timestamp: r.timestamp,
      text: `Retiro #${r.id}: ${r.amount.toLocaleString('es-MX')} ESCB por “${r.beneficiary}”`,
    })
  return items.sort((a, b) => b.timestamp - a.timestamp)
}
