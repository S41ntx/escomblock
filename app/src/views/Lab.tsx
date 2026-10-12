import { useState } from 'react'
import { Addr, BatchPill, Empty, NeedRole, SectionHead, useApp } from '../components/ui'
import { fmtDate, fmtInt, fmtKg, fmtMpa, fmtPct, sha256Hex } from '../lib/format'
import type { Batch } from '../lib/types'

export default function Lab() {
  const { snap } = useApp()
  const me = snap.account
  if (!me?.roles.includes('Lab'))
    return (
      <section>
        <SectionHead title="Laboratorio" />
        <NeedRole role="Lab" />
      </section>
    )
  const pending = snap.batches.filter((b) => b.status === 'Pending')
  const done = snap.batches.filter((b) => b.certification).reverse()

  return (
    <>
      <section>
        <SectionHead title="Laboratorio">
          <p className="muted">
            Los créditos ESCB solo existen si un laboratorio independiente aprueba el lote. La planta no puede
            certificarse a sí misma.
          </p>
        </SectionHead>
        {pending.length === 0 ? (
          <Empty>No hay lotes esperando ensayo.</Empty>
        ) : (
          <div className="grid-2">
            {pending.map((b) => (
              <CertifyForm key={b.id} batch={b} />
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h3>Ensayos registrados</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Resultado</th>
                <th className="r">f'c</th>
                <th className="r">Absorción</th>
                <th className="r">Ciclos</th>
                <th>Fecha</th>
                <th>Informe (sha-256)</th>
              </tr>
            </thead>
            <tbody>
              {done.map((b) => (
                <tr key={b.id}>
                  <td>#{b.id}</td>
                  <td>
                    <BatchPill status={b.status} />
                  </td>
                  <td className="r">{fmtMpa(b.certification!.strengthMpa)}</td>
                  <td className="r">{fmtPct(b.certification!.absorptionPct)}</td>
                  <td className="r">{b.certification!.thermalCycles}</td>
                  <td>{fmtDate(b.certification!.timestamp)}</td>
                  <td className="mono muted">{b.certification!.reportHash.slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Gauge({
  label,
  value,
  limit,
  max,
  unit,
  higherIsBetter,
}: {
  label: string
  value: number
  limit: number
  max: number
  unit: string
  higherIsBetter: boolean
}) {
  const pass = higherIsBetter ? value >= limit : value <= limit
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`
  return (
    <div className={`gauge ${pass ? '' : 'fail'}`}>
      <span>
        {label}{' '}
        <span className="muted">
          ({higherIsBetter ? 'mín.' : 'máx.'} {[limit, unit].filter(Boolean).join(' ')})
        </span>
      </span>
      <span className={`pill ${pass ? 'ok' : 'bad'}`}>{pass ? 'Cumple' : 'No cumple'}</span>
      <div className="bar" aria-hidden="true">
        <div className="fill" style={{ width: pct(value) }} />
        <div className="limit" style={{ left: pct(limit) }} />
      </div>
    </div>
  )
}

function CertifyForm({ batch }: { batch: Batch }) {
  const { snap, api, run, busy } = useApp()
  const std = snap.config.standard
  const [strength, setStrength] = useState('4.80')
  const [absorption, setAbsorption] = useState('10.2')
  const [cycles, setCycles] = useState('60')
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null)
  const s = Number(strength) || 0
  const a = Number(absorption) || 0
  const c = Math.floor(Number(cycles) || 0)
  const passes = s >= std.minStrengthMpa && a <= std.maxAbsorptionPct && c >= std.minThermalCycles

  return (
    <form
      className="panel form"
      onSubmit={async (e) => {
        e.preventDefault()
        const hash =
          file?.hash ?? (await sha256Hex(`escomblock lote ${batch.id} ${s} MPa ${a} % ${c} ciclos`))
        run(
          () => api.certifyBatch(batch.id, s, a, c, hash),
          (r) =>
            r.passed
              ? `Lote #${batch.id} certificado. ${fmtInt(batch.rubbleKg)} ESCB emitidos a la planta.`
              : `Lote #${batch.id} rechazado. No se emiten créditos.`,
        )
      }}
    >
      <div>
        <h3>
          Lote #{batch.id} · {fmtInt(batch.blocks)} bloques
        </h3>
        <p className="muted" style={{ fontSize: 13 }}>
          {batch.mix} · {fmtKg(batch.rubbleKg)} de escombro · <Addr a={batch.plant} /> · {fmtDate(batch.createdAt)}
        </p>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor={`s${batch.id}`}>f'c compresión (MPa)</label>
          <input id={`s${batch.id}`} type="number" step="0.01" min="0" value={strength} onChange={(e) => setStrength(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`a${batch.id}`}>Absorción (%)</label>
          <input id={`a${batch.id}`} type="number" step="0.1" min="0" value={absorption} onChange={(e) => setAbsorption(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`c${batch.id}`}>Ciclos calor-humedad</label>
          <input id={`c${batch.id}`} type="number" step="1" min="0" value={cycles} onChange={(e) => setCycles(e.target.value)} />
        </div>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <Gauge label="Resistencia" value={s} limit={std.minStrengthMpa} max={std.minStrengthMpa * 2} unit="MPa" higherIsBetter />
        <Gauge label="Absorción de agua" value={a} limit={std.maxAbsorptionPct} max={std.maxAbsorptionPct * 2} unit="%" higherIsBetter={false} />
        <Gauge label="Ciclos sin falla" value={c} limit={std.minThermalCycles} max={std.minThermalCycles * 2} unit="" higherIsBetter />
      </div>
      <div className="field">
        <label htmlFor={`f${batch.id}`}>Informe del ensayo (PDF)</label>
        <input
          id={`f${batch.id}`}
          type="file"
          accept="application/pdf,image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            setFile(f ? { name: f.name, hash: await sha256Hex(await f.arrayBuffer()) } : null)
          }}
        />
        <span className="hint">
          {file
            ? `sha-256 ${file.hash.slice(0, 24)}… se guarda en la cadena; el PDF queda contigo.`
            : 'Solo se publica la huella sha-256 del archivo, nunca el archivo.'}
        </span>
      </div>
      <button className={`btn ${passes ? 'primary' : ''}`} disabled={busy}>
        {passes ? 'Certificar y emitir ESCB' : 'Registrar rechazo'}
      </button>
    </form>
  )
}
