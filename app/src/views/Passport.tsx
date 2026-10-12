import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Addr, BatchPill, Empty, SectionHead, useApp } from '../components/ui'
import { CONTRACTS, NETWORK } from '../lib/config'
import { fmtDate, fmtEscb, fmtInt, fmtKg, fmtMpa, fmtPct, fmtUsdc } from '../lib/format'

export default function Passport({ id }: { id: number }) {
  const { snap, api, go } = useApp()
  const batch = snap.batches.find((b) => b.id === id)
  const [qr, setQr] = useState('')
  const url = `${location.origin}${location.pathname}#pasaporte-${id}`

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 0, width: 352, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''))
  }, [url])

  const picker = (
    <div className="btns">
      {snap.batches.map((b) => (
        <button
          key={b.id}
          className={`btn small ${b.id === id ? '' : 'ghost'}`}
          onClick={() => go(`pasaporte-${b.id}`)}
          aria-pressed={b.id === id}
        >
          Lote #{b.id}
        </button>
      ))}
    </div>
  )

  if (!batch)
    return (
      <section>
        <SectionHead title="Pasaporte de bloque">{picker}</SectionHead>
        <Empty>No existe el lote #{id}.</Empty>
      </section>
    )

  const deliveries = snap.deliveries.filter((d) => batch.deliveries.includes(d.id))
  const cert = batch.certification
  const std = snap.config.standard
  const paid = deliveries.reduce((n, d) => n + d.payout, 0)
  const collectors = new Set(deliveries.map((d) => d.collector)).size

  return (
    <section className="stack" style={{ gap: 20 }}>
      <SectionHead title="Pasaporte de bloque">{picker}</SectionHead>
      <article className="passport">
        <div className="main">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <div>
              <span className="label">Escomblock · lote</span>
              <h2>#{String(batch.id).padStart(4, '0')}</h2>
            </div>
            <BatchPill status={batch.status} />
          </div>
          <div className="facts">
            <div>
              <span className="label">Bloques</span>
              <strong>{fmtInt(batch.blocks)}</strong>
            </div>
            <div>
              <span className="label">Escombro reciclado</span>
              <strong>{fmtKg(batch.rubbleKg)}</strong>
            </div>
            <div>
              <span className="label">Por bloque</span>
              <strong>{(batch.rubbleKg / batch.blocks).toFixed(1)} kg</strong>
            </div>
            <div>
              <span className="label">Créditos emitidos</span>
              <strong>{batch.creditsMinted ? fmtEscb(batch.creditsMinted) : '—'}</strong>
            </div>
            <div>
              <span className="label">Dosificación</span>
              <strong style={{ fontSize: 14, fontWeight: 500 }}>{batch.mix}</strong>
            </div>
            <div>
              <span className="label">Fabricado por</span>
              <strong style={{ fontSize: 14, fontWeight: 500 }}>
                <Addr a={batch.plant} />
              </strong>
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Ensayo de laboratorio</span>
            {cert ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Prueba</th>
                      <th className="r">Resultado</th>
                      <th className="r">Requisito</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Resistencia a compresión</td>
                      <td className="r">{fmtMpa(cert.strengthMpa)}</td>
                      <td className="r">≥ {fmtMpa(std.minStrengthMpa)}</td>
                      <td>{cert.strengthMpa >= std.minStrengthMpa ? '✓' : '✗'}</td>
                    </tr>
                    <tr>
                      <td>Absorción de agua</td>
                      <td className="r">{fmtPct(cert.absorptionPct)}</td>
                      <td className="r">≤ {fmtPct(std.maxAbsorptionPct)}</td>
                      <td>{cert.absorptionPct <= std.maxAbsorptionPct ? '✓' : '✗'}</td>
                    </tr>
                    <tr>
                      <td>Ciclos calor-humedad sin falla</td>
                      <td className="r">{cert.thermalCycles}</td>
                      <td className="r">≥ {std.minThermalCycles}</td>
                      <td>{cert.thermalCycles >= std.minThermalCycles ? '✓' : '✗'}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  <Addr a={cert.lab} /> · {fmtDate(cert.timestamp)} · informe sha-256{' '}
                  <span className="mono">{cert.reportHash.slice(0, 20)}…</span>
                </p>
              </div>
            ) : (
              <Empty>Este lote espera su ensayo de laboratorio.</Empty>
            )}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="label">
              Origen del escombro · {deliveries.length} entregas de {collectors} recolectores, {fmtUsdc(paid)} pagados
            </span>
            <div className="table-wrap">
              <table>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>#{d.id}</td>
                      <td>{d.origin}</td>
                      <td className="r">{fmtKg(d.kg)}</td>
                      <td>
                        <Addr a={d.collector} />
                      </td>
                      <td>{fmtDate(d.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside className="stub">
          {qr ? <img src={qr} alt={`Código QR del pasaporte del lote ${batch.id}`} /> : null}
          <span className="label">Escanea el bloque</span>
          <p className="muted" style={{ fontSize: 13 }}>
            Este código va impreso en cada bloque del lote y abre este pasaporte.
          </p>
          {api.mode === 'testnet' ? (
            <a href={`${NETWORK.explorer}/contract/${CONTRACTS.core}`} target="_blank" rel="noreferrer">
              Ver contrato en Stellar Expert
            </a>
          ) : (
            <span className="mono muted" style={{ fontSize: 11 }}>
              datos de demostración
            </span>
          )}
        </aside>
      </article>
    </section>
  )
}
