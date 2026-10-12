import { Addr, Empty, SectionHead, useApp } from '../components/ui'
import { fmtDate, fmtInt, fmtKg, fmtUsdc } from '../lib/format'

export default function Collectors() {
  const { snap } = useApp()
  const me = snap.account?.address
  const rows = new Map<string, { kg: number; usdc: number; trips: number; last: number }>()
  for (const d of snap.deliveries) {
    const r = rows.get(d.collector) ?? { kg: 0, usdc: 0, trips: 0, last: 0 }
    r.kg += d.kg
    r.usdc += d.payout
    r.trips++
    r.last = Math.max(r.last, d.timestamp)
    rows.set(d.collector, r)
  }
  const ranked = [...rows.entries()].sort((a, b) => b[1].usdc - a[1].usdc)
  const mine = snap.deliveries.filter((d) => d.collector === me).reverse()

  return (
    <>
      <section>
        <SectionHead title="Recolectores">
          <p className="muted">
            Quien mueve el escombro cobra por kilo en USDC al momento de la pesada, sin intermediarios ni esperas de
            fin de mes. Solo necesita una wallet Stellar.
          </p>
        </SectionHead>
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recolector</th>
                  <th className="r">Viajes</th>
                  <th className="r">Escombro</th>
                  <th className="r">Cobrado</th>
                  <th>Última entrega</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(([addr, r]) => (
                  <tr key={addr}>
                    <td>
                      <Addr a={addr} you={me} />
                    </td>
                    <td className="r">{fmtInt(r.trips)}</td>
                    <td className="r">{fmtKg(r.kg)}</td>
                    <td className="r">{fmtUsdc(r.usdc)}</td>
                    <td>{fmtDate(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="panel">
        <h3>Mis boletas</h3>
        {mine.length === 0 ? (
          <Empty>
            Tu cuenta no tiene entregas. En la demo, elige el actor “Guadalupe R. · recolectora” para ver su
            historial.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Boleta</th>
                  <th>Origen</th>
                  <th className="r">Peso</th>
                  <th className="r">Pago</th>
                  <th>Fecha</th>
                  <th>Usado en</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((d) => (
                  <tr key={d.id}>
                    <td>#{d.id}</td>
                    <td>{d.origin}</td>
                    <td className="r">{fmtKg(d.kg)}</td>
                    <td className="r">{fmtUsdc(d.payout)}</td>
                    <td>{fmtDate(d.timestamp)}</td>
                    <td>{d.batchId ? <a href={`#pasaporte-${d.batchId}`}>lote #{d.batchId}</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
