import { useCallback, useEffect, useMemo, useState } from 'react'
import * as freighter from '@stellar/freighter-api'
import { Ctx, TxLink, type AppCtx } from './components/ui'
import { CONTRACTS, MISSING, NETWORK } from './lib/config'
import { fmtEscb, fmtUsdc, shortAddr } from './lib/format'
import { SorobanApi, connectFreighter } from './lib/soroban'
import type { Snapshot, TxResult } from './lib/types'
import Collectors from './views/Collectors'
import Home from './views/Home'
import Lab from './views/Lab'
import Market from './views/Market'
import Passport from './views/Passport'
import Plant from './views/Plant'

const TABS: [string, string][] = [
  ['inicio', 'Inicio'],
  ['planta', 'Planta'],
  ['laboratorio', 'Laboratorio'],
  ['mercado', 'Mercado'],
  ['recolectores', 'Recolectores'],
  ['pasaporte', 'Pasaporte'],
]

const readRoute = () => location.hash.replace(/^#/, '') || 'inicio'

interface Toast {
  text: string
  error?: boolean
  hash?: string
}

export default function App() {
  if (MISSING.length) return <Setup />
  return <Live />
}

function Setup() {
  return (
    <>
      <Header route="" />
      <main>
        <section className="panel stack">
          <h2 className="section">Configuración pendiente</h2>
          <p>
            Esta compilación no sabe a qué contratos conectarse. Despliega los contratos con{' '}
            <span className="mono">scripts/deploy.sh</span> y vuelve a compilar con estas variables:
          </p>
          <ul className="mono">
            {MISSING.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="muted">Ver app/.env.example y docs/DEPLOY.md en el repositorio.</p>
        </section>
      </main>
    </>
  )
}

function Header({ route }: { route: string }) {
  return (
    <header className="top">
      <div className="tape" />
      <div className="top-inner">
        <a className="wordmark" href="#inicio">
          <span className="brick" aria-hidden="true" />
          ESCOMBLOCK
        </a>
        <nav className="tabs" aria-label="Secciones">
          {TABS.map(([key, label]) => (
            <a key={key} href={`#${key}`} aria-current={route === key ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="who">
          <a
            className={`mode ${NETWORK.name === 'mainnet' ? 'live' : ''}`}
            href={`${NETWORK.explorer}/contract/${CONTRACTS.core}`}
            target="_blank"
            rel="noreferrer"
            title="Ver el contrato en el explorador"
          >
            ● {NETWORK.label}
          </a>
        </div>
      </div>
    </header>
  )
}

function Live() {
  const [route, setRoute] = useState(readRoute)
  const [wallet, setWallet] = useState<string | null>(null)
  const api = useMemo(() => new SorobanApi(wallet), [wallet])
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    const on = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  // Reconnect silently if this site was already allowed in Freighter.
  useEffect(() => {
    freighter
      .isAllowed()
      .then((r) => (r.isAllowed ? freighter.getAddress() : null))
      .then((r) => {
        if (r && !r.error && r.address) setWallet(r.address)
      })
      .catch(() => undefined)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setSnap(await api.snapshot())
      setLoadError('')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [api])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.error ? 8000 : 6000)
    return () => clearTimeout(t)
  }, [toast])

  const go = useCallback((r: string) => {
    location.hash = r
  }, [])

  const run = useCallback<AppCtx['run']>(
    async (fn, ok) => {
      setBusy(true)
      try {
        const r: TxResult = await fn()
        setToast({ text: ok(r), hash: r.hash })
        await refresh()
        return r
      } catch (err) {
        setToast({ text: err instanceof Error ? err.message : String(err), error: true })
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const connect = async () => {
    try {
      setWallet(await connectFreighter())
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : String(err), error: true })
    }
  }

  const passportId = route.startsWith('pasaporte') ? Number(route.split('-')[1]) || 0 : -1
  const tabKey = passportId >= 0 ? 'pasaporte' : route
  const acct = snap?.account

  let view: React.ReactNode = null
  if (snap) {
    if (passportId >= 0) view = <Passport id={passportId || snap.batches.at(-1)?.id || 0} />
    else if (route === 'planta') view = <Plant />
    else if (route === 'laboratorio') view = <Lab />
    else if (route === 'mercado') view = <Market />
    else if (route === 'recolectores') view = <Collectors />
    else view = <Home />
  }

  return (
    <>
      <Header route={tabKey} />
      <main>
        <div className="walletbar">
          {wallet ? (
            <div className="bal">
              <span className="label">Wallet</span>
              <a className="addr" href={`${NETWORK.explorer}/account/${wallet}`} target="_blank" rel="noreferrer">
                <strong className="mono">{shortAddr(wallet)}</strong>
              </a>
            </div>
          ) : (
            <div className="stack" style={{ gap: 4 }}>
              <button className="btn primary" onClick={connect}>
                Conectar wallet
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                Puedes consultar todo sin wallet. Para operar usa Freighter.
              </span>
            </div>
          )}
          <span className="spacer" />
          {acct && (
            <>
              <div className="bal">
                <span className="label">USDC</span>
                <strong>{acct.trust.usdc ? fmtUsdc(acct.usdc).replace(' USDC', '') : '—'}</strong>
              </div>
              <div className="bal">
                <span className="label">ESCB</span>
                <strong>{acct.trust.escb ? fmtEscb(acct.escb).replace(' ESCB', '') : '—'}</strong>
              </div>
              <div className="bal">
                <span className="label">Rol</span>
                <strong style={{ fontSize: 14 }}>
                  {acct.roles.includes('Plant')
                    ? 'Planta'
                    : acct.roles.includes('Lab')
                      ? 'Laboratorio'
                      : 'Recolector / comprador'}
                </strong>
              </div>
              {acct.funded && (!acct.trust.usdc || !acct.trust.escb) && (
                <div className="btns">
                  {!acct.trust.usdc && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => run(() => api.trust('usdc'), () => 'USDC activado: ya puedes recibir pagos.')}
                    >
                      Activar USDC
                    </button>
                  )}
                  {!acct.trust.escb && (
                    <button
                      className="btn small ghost"
                      disabled={busy}
                      onClick={() => run(() => api.trust('escb'), () => 'ESCB activado: ya puedes recibir créditos.')}
                    >
                      Activar ESCB
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {acct && !acct.funded && (
          <div className="notice" role="status">
            Tu cuenta aún no existe en {NETWORK.label}. Envíale al menos 2 XLM desde un exchange o de otra wallet para
            activarla; después podrás activar USDC y ESCB.
          </div>
        )}
        {snap && (snap.config.corePaused || snap.config.marketPaused) && (
          <div className="notice" role="status">
            {snap.config.corePaused ? 'El registro está en pausa por mantenimiento. ' : ''}
            {snap.config.marketPaused ? 'El mercado no acepta compras ni publicaciones nuevas por ahora.' : ''}
          </div>
        )}
        {loadError && (
          <div className="empty" role="alert">
            No se pudo leer la red ({NETWORK.rpcUrl}): {loadError}
          </div>
        )}
        {!snap && !loadError && <div className="empty">Leyendo contratos en {NETWORK.label}…</div>}
        {snap && <Ctx.Provider value={{ api, snap, busy, run, go }}>{view}</Ctx.Provider>}
      </main>

      <footer>
        <span>Escomblock · escombro reciclado en mampostería, trazado y pagado en Stellar</span>
        <span className="btns">
          <a href={`${NETWORK.explorer}/contract/${CONTRACTS.core}`} target="_blank" rel="noreferrer">
            Contrato
          </a>
          <a href="https://github.com/S41ntx/escomblock" target="_blank" rel="noreferrer">
            Código fuente
          </a>
        </span>
      </footer>

      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.hash && <TxLink hash={toast.hash} />}
        </div>
      )}
    </>
  )
}
