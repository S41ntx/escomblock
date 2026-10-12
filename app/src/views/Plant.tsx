import { useMemo, useState } from 'react'
import { Addr, BatchPill, Empty, NeedRole, OrderPill, SectionHead, useApp } from '../components/ui'
import { COLLECTORS } from '../lib/demo'
import { fmtDate, fmtEscb, fmtInt, fmtKg, fmtUsdc } from '../lib/format'

export default function Plant() {
  const { snap } = useApp()
  const me = snap.account
  if (!me?.roles.includes('Plant'))
    return (
      <section>
        <SectionHead title="Planta" />
        <NeedRole role="Plant" />
      </section>
    )
  return (
    <>
      <section>
        <SectionHead title="Báscula y lotes">
          <p className="muted">Registra lo que llega, paga al recolector y arma lotes para el laboratorio.</p>
        </SectionHead>
        <div className="grid-2">
          <Scale />
          <NewBatch />
        </div>
      </section>
      <Batches />
      <Shipping />
    </>
  )
}

function Scale() {
  const { snap, api, run, busy } = useApp()
  const [collector, setCollector] = useState(COLLECTORS[0].address)
  const [custom, setCustom] = useState('')
  const [kg, setKg] = useState('4200')
  const [origin, setOrigin] = useState('Demolición vivienda, Col. Centro')
  const address = collector === 'other' ? custom.trim() : collector
  const kgN = Math.floor(Number(kg) || 0)
  const payout = kgN * snap.config.pricePerKg

  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => api.recordDelivery(address, kgN, origin.trim()),
          (r) => `Entrega #${r.id} registrada. ${fmtUsdc(payout)} enviados al recolector.`,
        )
      }}
    >
      <h3>Boleta de báscula</h3>
      <div className="field">
        <label htmlFor="collector">Recolector</label>
        <select id="collector" value={collector} onChange={(e) => setCollector(e.target.value)}>
          {api.mode === 'demo' &&
            COLLECTORS.map((c) => (
              <option key={c.address} value={c.address}>
                {c.name} · {c.address.slice(0, 6)}…
              </option>
            ))}
          <option value="other">Otra cuenta Stellar…</option>
        </select>
        {(collector === 'other' || api.mode !== 'demo') && (
          <input
            id="collector-address"
            type="text"
            placeholder="G… dirección del recolector"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value)
              setCollector('other')
            }}
          />
        )}
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="kg">Peso neto (kg)</label>
          <input id="kg" type="number" min="1" step="1" value={kg} onChange={(e) => setKg(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="origin">Origen</label>
          <input id="origin" type="text" value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </div>
      </div>
      <div className="readout">
        <span className="muted">
          {fmtKg(kgN)} × {fmtUsdc(snap.config.pricePerKg * 1000)}/t
        </span>
        <strong>{fmtUsdc(payout)}</strong>
      </div>
      <button className="btn primary" disabled={busy || !kgN || !address}>
        Registrar y pagar
      </button>
    </form>
  )
}

function NewBatch() {
  const { snap, api, run, busy } = useApp()
  const me = snap.account!
  const free = snap.deliveries.filter((d) => d.plant === me.address && d.batchId === 0)
  const [picked, setPicked] = useState<number[]>([])
  const [blocks, setBlocks] = useState('')
  const [mix, setMix] = useState('40 % escombro cribado + CPC 30R + arena')
  const kg = free.filter((d) => picked.includes(d.id)).reduce((n, d) => n + d.kg, 0)
  const suggested = Math.floor(kg / 5)
  const blocksN = Math.floor(Number(blocks) || suggested)

  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => api.createBatch(picked, blocksN, mix.trim()),
          (r) => `Lote #${r.id} creado. Ya puede ir al laboratorio.`,
        ).then((r) => r && setPicked([]))
      }}
    >
      <h3>Nuevo lote de producción</h3>
      {free.length === 0 ? (
        <Empty>No hay entregas sin lote. Registra una en la báscula.</Empty>
      ) : (
        <div className="check-list" role="group" aria-label="Entregas disponibles">
          {free.map((d) => (
            <label key={d.id}>
              <input
                type="checkbox"
                checked={picked.includes(d.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))
                }
              />
              <span>
                #{d.id} · {d.origin}
              </span>
              <span className="num">{fmtKg(d.kg)}</span>
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <div className="field">
          <label htmlFor="blocks">Bloques producidos</label>
          <input
            id="blocks"
            type="number"
            min="1"
            placeholder={suggested ? String(suggested) : '—'}
            value={blocks}
            onChange={(e) => setBlocks(e.target.value)}
          />
          <span className="hint">Bloque 12×20×40 cm ≈ 5 kg de escombro</span>
        </div>
        <div className="field">
          <label htmlFor="mix">Dosificación</label>
          <input id="mix" type="text" value={mix} onChange={(e) => setMix(e.target.value)} />
        </div>
      </div>
      <div className="readout">
        <span className="muted">
          {picked.length} entregas · {fmtKg(kg)}
        </span>
        <strong>{blocksN ? `${(kg / blocksN).toFixed(1)} kg/bloque` : '—'}</strong>
      </div>
      <button className="btn" disabled={busy || !picked.length || !blocksN}>
        Crear lote
      </button>
    </form>
  )
}

function Batches() {
  const { snap, api, run, busy, go } = useApp()
  const me = snap.account!
  const mine = snap.batches.filter((b) => b.plant === me.address).slice().reverse()
  const listedOf = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of snap.listings) m.set(l.batchId, (m.get(l.batchId) ?? 0) + l.available + l.sold)
    return m
  }, [snap.listings])
  const [price, setPrice] = useState('0.75')

  return (
    <section className="panel">
      <div className="section-head" style={{ marginBottom: 6 }}>
        <h3>Mis lotes</h3>
        <div className="field" style={{ gridTemplateColumns: 'auto 110px', alignItems: 'center', gap: 8 }}>
          <label htmlFor="price">Precio por bloque (USDC)</label>
          <input id="price" type="number" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      {mine.length === 0 ? (
        <Empty>Aún no hay lotes.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Estado</th>
                <th className="r">Escombro</th>
                <th className="r">Bloques</th>
                <th className="r">ESCB</th>
                <th>Creado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.map((b) => {
                const left = b.blocks - (listedOf.get(b.id) ?? 0)
                return (
                  <tr key={b.id}>
                    <td>
                      <a href={`#pasaporte-${b.id}`} onClick={(e) => (e.preventDefault(), go(`pasaporte-${b.id}`))}>
                        #{b.id}
                      </a>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {b.mix}
                      </div>
                    </td>
                    <td>
                      <BatchPill status={b.status} />
                    </td>
                    <td className="r">{fmtKg(b.rubbleKg)}</td>
                    <td className="r">{fmtInt(b.blocks)}</td>
                    <td className="r">{b.creditsMinted ? fmtEscb(b.creditsMinted) : '—'}</td>
                    <td>{fmtDate(b.createdAt)}</td>
                    <td className="r">
                      {b.status === 'Certified' && left > 0 && (
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => api.list(b.id, left, Number(price)),
                              (r) => `Publicación #${r.id}: ${fmtInt(left)} bloques en el mercado.`,
                            )
                          }
                        >
                          Vender {fmtInt(left)}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Shipping() {
  const { snap, api, run, busy } = useApp()
  const me = snap.account!
  const orders = snap.orders.filter((o) => o.seller === me.address && (o.status === 'Paid' || o.status === 'Shipped'))
  const myListings = snap.listings.filter((l) => l.seller === me.address && l.active)
  const now = Date.now() / 1000

  return (
    <section className="grid-2">
      <div className="panel">
        <h3>Pedidos por surtir</h3>
        {orders.length === 0 ? (
          <Empty>Sin pedidos pendientes.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      #{o.id} · {fmtInt(o.qty)} bloques
                      <div className="muted" style={{ fontSize: 12 }}>
                        <Addr a={o.buyer} />
                      </div>
                    </td>
                    <td>
                      <OrderPill status={o.status} />
                    </td>
                    <td className="r">{fmtUsdc(o.total)}</td>
                    <td className="r">
                      {o.status === 'Paid' ? (
                        <button className="btn small" disabled={busy} onClick={() => run(() => api.ship(o.id), () => `Pedido #${o.id} marcado como enviado.`)}>
                          Marcar enviado
                        </button>
                      ) : (
                        <button
                          className="btn small ghost"
                          disabled={busy || now < o.shippedAt + snap.config.claimAfterDays * 86400}
                          title={`Disponible ${snap.config.claimAfterDays} días después del envío`}
                          onClick={() => run(() => api.claim(o.id), () => `Pedido #${o.id} liquidado.`)}
                        >
                          Reclamar pago
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="panel">
        <h3>Publicaciones activas</h3>
        {myListings.length === 0 ? (
          <Empty>Nada publicado. Vende un lote certificado desde “Mis lotes”.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {myListings.map((l) => (
                  <tr key={l.id}>
                    <td>
                      #{l.id} · lote #{l.batchId}
                    </td>
                    <td className="r">
                      {fmtInt(l.available)} disp. · {fmtInt(l.sold)} vendidos
                    </td>
                    <td className="r">{fmtUsdc(l.pricePerBlock)}</td>
                    <td className="r">
                      <button className="btn small ghost" disabled={busy} onClick={() => run(() => api.delist(l.id), () => `Publicación #${l.id} cerrada; ESCB devueltos.`)}>
                        Cerrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
