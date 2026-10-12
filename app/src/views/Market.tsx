import { useState } from 'react'
import { Addr, Empty, OrderPill, SectionHead, useApp } from '../components/ui'
import { fmtDate, fmtEscb, fmtInt, fmtKg, fmtMpa, fmtUsdc } from '../lib/format'
import type { Listing } from '../lib/types'

export default function Market() {
  const { snap } = useApp()
  const open = snap.listings.filter((l) => l.active && l.available > 0)
  return (
    <>
      <section>
        <SectionHead title="Mercado">
          <p className="muted">
            Cada bloque viene con sus créditos ESCB. Tu pago queda en garantía en el contrato hasta que confirmes
            la entrega. Comisión de {snap.config.feeBps / 100} % al fondo de recolectores.
          </p>
        </SectionHead>
        {open.length === 0 ? (
          <Empty>No hay bloques a la venta en este momento.</Empty>
        ) : (
          <div className="grid-3">
            {open.map((l) => (
              <ListingCard key={l.id} l={l} />
            ))}
          </div>
        )}
      </section>
      <MyOrders />
      <Retire />
    </>
  )
}

function ListingCard({ l }: { l: Listing }) {
  const { snap, api, run, busy, go } = useApp()
  const batch = snap.batches.find((b) => b.id === l.batchId)
  const [qty, setQty] = useState(String(Math.min(500, l.available)))
  const q = Math.floor(Number(qty) || 0)
  const mine = snap.account?.address === l.seller

  return (
    <div className="panel listing">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <span className="label">Lote #{l.batchId}</span>
        <a href={`#pasaporte-${l.batchId}`} onClick={(e) => (e.preventDefault(), go(`pasaporte-${l.batchId}`))}>
          Pasaporte
        </a>
      </div>
      <div>
        <span className="price num">{l.pricePerBlock.toFixed(2)}</span> <span className="muted">USDC / bloque</span>
      </div>
      <div className="facts" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <span className="label">Disponibles</span>
          <strong>{fmtInt(l.available)}</strong>
        </div>
        <div>
          <span className="label">ESCB por bloque</span>
          <strong>{l.creditsPerBlock.toFixed(1)}</strong>
        </div>
        {batch?.certification && (
          <div>
            <span className="label">Resistencia</span>
            <strong>{fmtMpa(batch.certification.strengthMpa)}</strong>
          </div>
        )}
        {batch && (
          <div>
            <span className="label">Escombro</span>
            <strong>{fmtKg(batch.rubbleKg)}</strong>
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Vende <Addr a={l.seller} />
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => api.buy(l.id, q), (r) => `Pedido #${r.id}: ${fmtUsdc(q * l.pricePerBlock)} en garantía.`)
        }}
      >
        <div className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end' }}>
          <div className="field">
            <label htmlFor={`q${l.id}`}>Bloques</label>
            <input id={`q${l.id}`} type="number" min="1" max={l.available} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <button className="btn primary" disabled={busy || mine || !q || q > l.available}>
            Comprar {fmtUsdc(q * l.pricePerBlock)}
          </button>
        </div>
        {mine && <span className="hint muted">Es tu publicación.</span>}
      </form>
    </div>
  )
}

function MyOrders() {
  const { snap, api, run, busy } = useApp()
  const me = snap.account
  const orders = me ? snap.orders.filter((o) => o.buyer === me.address).slice().reverse() : []
  return (
    <section className="panel">
      <h3>Mis compras</h3>
      {orders.length === 0 ? (
        <Empty>
          Aún no compras bloques.
          {snap.account?.roles.length ? ' Cambia al actor “Constructora del Desierto” para probar la compra.' : ''}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Estado</th>
                <th className="r">Bloques</th>
                <th className="r">Total</th>
                <th className="r">ESCB incluidos</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>
                    <OrderPill status={o.status} />
                  </td>
                  <td className="r">{fmtInt(o.qty)}</td>
                  <td className="r">{fmtUsdc(o.total)}</td>
                  <td className="r">{fmtEscb(o.credits)}</td>
                  <td>{fmtDate(o.createdAt)}</td>
                  <td className="r">
                    <div className="btns" style={{ justifyContent: 'flex-end' }}>
                      {(o.status === 'Paid' || o.status === 'Shipped') && (
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() =>
                            run(() => api.confirm(o.id), () => `Recibido. Pago liberado y ${fmtEscb(o.credits)} en tu wallet.`)
                          }
                        >
                          Confirmar recepción
                        </button>
                      )}
                      {o.status === 'Paid' && (
                        <button className="btn small ghost" disabled={busy} onClick={() => run(() => api.cancel(o.id), () => `Pedido #${o.id} cancelado y reembolsado.`)}>
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Retire() {
  const { snap, api, run, busy } = useApp()
  const bal = snap.account?.escb ?? 0
  const [amount, setAmount] = useState('1000')
  const [who, setWho] = useState('Obra: Escuela primaria, Hermosillo')
  const n = Number(amount) || 0
  return (
    <section className="grid-2">
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => api.retire(n, who.trim()), (r) => `Certificado de retiro #${r.id}: ${fmtEscb(n)} quemados.`)
        }}
      >
        <h3>Retirar impacto</h3>
        <p className="muted">
          Retirar quema los ESCB y deja un registro permanente de quién reclama esos kilos de escombro desviado.
          Así nadie cuenta dos veces el mismo impacto.
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="ret-amount">ESCB (tienes {fmtInt(bal)})</label>
            <input id="ret-amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ret-who">A nombre de</label>
            <input id="ret-who" type="text" value={who} onChange={(e) => setWho(e.target.value)} />
          </div>
        </div>
        <button className="btn" disabled={busy || n <= 0 || n > bal || !who.trim()}>
          Retirar {fmtEscb(n)}
        </button>
      </form>
      <div className="panel">
        <h3>Certificados de retiro</h3>
        {snap.retirements.length === 0 ? (
          <Empty>Ningún retiro todavía.</Empty>
        ) : (
          <ul className="feed">
            {snap.retirements
              .slice()
              .reverse()
              .map((r) => (
                <li key={r.id}>
                  <time>{fmtDate(r.timestamp)}</time>
                  <span>
                    <strong>{fmtEscb(r.amount)}</strong> = {fmtKg(r.amount)} de escombro fuera del tiradero, a nombre de “
                    {r.beneficiary}”
                    <span className="hash">
                      <Addr a={r.by} you={snap.account?.address} />
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  )
}
