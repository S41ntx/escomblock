import { TxLink, useApp } from '../components/ui'
import { fmtDateTime, fmtInt, fmtUsdc } from '../lib/format'

export default function Home() {
  const { snap, api, go } = useApp()
  const st = snap.stats
  const collectors = new Set(snap.deliveries.map((d) => d.collector)).size

  return (
    <>
      <section className="hero">
        <h1>
          El escombro de ayer es el <mark>bloque</mark> de mañana
        </h1>
        <div className="lede">
          <p>
            En casi todo México el escombro no está regulado y termina en baldíos y arroyos. Escomblock lo
            convierte en bloques de mampostería que resisten el calor y la humedad de Hermosillo, y usa
            Stellar para que cada kilo sea trazable y cada recolector cobre en el momento.
          </p>
          <div className="btns">
            <button className="btn primary" onClick={() => go('planta')}>
              Registrar una entrega
            </button>
            <button className="btn ghost" onClick={() => go('pasaporte-1')}>
              Ver un pasaporte de bloque
            </button>
          </div>
        </div>
      </section>

      <section className="kpis" aria-label="Impacto acumulado">
        <div className="kpi">
          <span className="label">Escombro desviado</span>
          <span className="v">
            {fmtInt(st.rubbleKg / 1000)}
            <small>t</small>
          </span>
          <span className="muted">{fmtInt(st.deliveries)} entregas pesadas en báscula</span>
        </div>
        <div className="kpi">
          <span className="label">Pagado a recolectores</span>
          <span className="v">
            {fmtInt(st.usdcPaid)}
            <small>USDC</small>
          </span>
          <span className="muted">{collectors} personas, pago al instante</span>
        </div>
        <div className="kpi">
          <span className="label">Bloques certificados</span>
          <span className="v">{fmtInt(st.certifiedBlocks)}</span>
          <span className="muted">
            {st.certifiedBatches} de {st.batches} lotes aprobados
          </span>
        </div>
        <div className="kpi">
          <span className="label">Impacto retirado</span>
          <span className="v">
            {fmtInt(st.creditsRetired)}
            <small>ESCB</small>
          </span>
          <span className="muted">de {fmtInt(st.creditsMinted)} emitidos (1 ESCB = 1 kg)</span>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section">Cómo funciona</h2>
          <p className="muted">Cuatro pasos, cada uno es una transacción en Stellar.</p>
        </div>
        <div className="steps">
          <div className="step">
            <span className="n">1</span>
            <h3>Báscula</h3>
            <p>
              El recolector entrega escombro. La planta lo pesa y el contrato le paga{' '}
              {fmtUsdc(snap.config.pricePerKg * 1000)} por tonelada en la misma transacción.
            </p>
            <span className="chain">record_delivery → USDC (SAC)</span>
          </div>
          <div className="step">
            <span className="n">2</span>
            <h3>Lote</h3>
            <p>Las entregas se agrupan en un lote de bloques. Cada kilo queda ligado a su origen.</p>
            <span className="chain">create_batch</span>
          </div>
          <div className="step">
            <span className="n">3</span>
            <h3>Laboratorio</h3>
            <p>
              Un laboratorio independiente sube resistencia, absorción y ciclos de calor-humedad. Si pasa, se
              emiten créditos ESCB.
            </p>
            <span className="chain">certify_batch → mint ESCB</span>
          </div>
          <div className="step">
            <span className="n">4</span>
            <h3>Mercado</h3>
            <p>
              La constructora compra con USDC en garantía. Al recibir, la planta cobra y los ESCB pasan a la
              constructora, que puede retirarlos.
            </p>
            <span className="chain">buy → confirm → retire</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel">
          <h3>Actividad reciente</h3>
          <p className="muted" style={{ marginBottom: 8 }}>
            {api.mode === 'demo'
              ? 'Simulación local con las mismas reglas que los contratos.'
              : 'Leído de los contratos en Stellar testnet.'}
          </p>
          <ul className="feed">
            {snap.activity.slice(0, 8).map((a) => (
              <li key={a.id}>
                <time>{fmtDateTime(a.timestamp)}</time>
                <span>
                  {a.text}
                  {a.txHash && (
                    <span className="hash">
                      <TxLink hash={a.txHash} mode={api.mode} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel stack">
          <h3>Por qué Stellar</h3>
          <div className="why" style={{ gridTemplateColumns: '1fr' }}>
            <div>
              <h3>Pagos de centavos que sí llegan</h3>
              <p className="muted">
                Una entrega típica vale 10 a 30 USDC. Con comisiones de fracciones de centavo y cierre en
                segundos, pagar cada viaje tiene sentido. La red de anclas permite cobrar en efectivo o
                pesos.
              </p>
            </div>
            <div>
              <h3>Créditos que son activos reales</h3>
              <p className="muted">
                ESCB es un activo Stellar emitido por el contrato a través de su Stellar Asset Contract: se
                ve en cualquier wallet, se puede transferir y se quema al retirarlo.
              </p>
            </div>
            <div>
              <h3>Reglas en Soroban</h3>
              <p className="muted">
                Nadie emite créditos sin un laboratorio independiente, nadie usa dos veces el mismo
                escombro y el dinero del comprador queda en garantía hasta la entrega.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
