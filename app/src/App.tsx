import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ctx, TxLink, type AppCtx } from './components/ui'
import { FORCE_DEMO, LIVE_AVAILABLE, NETWORK } from './lib/config'
import { ACTORS, DemoApi } from './lib/demo'
import { fmtEscb, fmtUsdc, shortAddr } from './lib/format'
import { SorobanApi, connectFreighter } from './lib/soroban'
import type { Api, Mode, Snapshot, TxResult } from './lib/types'
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
  ['pasaporte-1', 'Pasaporte'],
]

const readRoute = () => location.hash.replace(/^#/, '') || 'inicio'

interface Toast {
  text: string
  error?: boolean
  hash?: string
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const [mode, setMode] = useState<Mode>(LIVE_AVAILABLE && !FORCE_DEMO ? 'testnet' : 'demo')
  const [wallet, setWallet] = useState<string | null>(null)
  const demo = useMemo(() => new DemoApi(), [])
  const api: Api = useMemo(() => (mode === 'demo' ? demo : new SorobanApi(wallet)), [mode, wallet, demo])
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [actor, setActor] = useState(demo.actor.key)

  useEffect(() => {
    const on = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
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
  }, [refresh, actor])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.error ? 7000 : 5500)
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

  const passportId = route.startsWith('pasaporte-') ? Number(route.slice(10)) || 1 : 0
  const tabKey = passportId ? 'pasaporte-1' : route

  let view: React.ReactNode = null
  if (snap) {
    if (passportId) view = <Passport id={passportId} />
    else if (route === 'planta') view = <Plant />
    else if (route === 'laboratorio') view = <Lab />
    else if (route === 'mercado') view = <Market />
    else if (route === 'recolectores') view = <Collectors />
    else view = <Home />
  }

  return (
    <>
      <header className="top">
        <div className="tape" />
        <div className="top-inner">
          <a className="wordmark" href="#inicio">
            <span className="brick" aria-hidden="true" />
            ESCOMBLOCK
          </a>
          <nav className="tabs" aria-label="Secciones">
            {TABS.map(([key, label]) => (
              <a key={key} href={`#${key}`} aria-current={tabKey === key ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="who">
            {LIVE_AVAILABLE && !FORCE_DEMO ? (
              <button
                className={`mode ${mode === 'testnet' ? 'live' : ''}`}
                onClick={() => setMode(mode === 'demo' ? 'testnet' : 'demo')}
                title="Cambiar entre demostración y Stellar testnet"
              >
                {mode === 'testnet' ? `● Stellar ${NETWORK.name}` : '○ Demo local'}
              </button>
            ) : (
              <span className="mode">Demo · reglas de los contratos</span>
            )}
          </div>
        </div>
      </header>

      <main>
        <div className="walletbar">
          {mode === 'demo' ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="label">Actuar como</span>
              <div className="actor-pick">
                {ACTORS.map((a) => (
                  <button
                    key={a.key}
                    aria-pressed={actor === a.key}
                    title={a.blurb}
                    onClick={() => {
                      demo.setActor(a.key)
                      setActor(a.key)
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          ) : wallet ? (
            <div className="bal">
              <span className="label">Wallet Freighter</span>
              <strong className="mono">{shortAddr(wallet)}</strong>
            </div>
          ) : (
            <button className="btn primary" onClick={connect}>
              Conectar Freighter
            </button>
          )}
          <span className="spacer" />
          {snap?.account && (
            <>
              <div className="bal">
                <span className="label">USDC</span>
                <strong>{fmtUsdc(snap.account.usdc).replace(' USDC', '')}</strong>
              </div>
              <div className="bal">
                <span className="label">ESCB</span>
                <strong>{fmtEscb(snap.account.escb).replace(' ESCB', '')}</strong>
              </div>
              <div className="bal">
                <span className="label">Rol</span>
                <strong style={{ fontSize: 14 }}>
                  {snap.account.roles.includes('Plant')
                    ? 'Planta'
                    : snap.account.roles.includes('Lab')
                      ? 'Laboratorio'
                      : 'Comprador / recolector'}
                </strong>
              </div>
            </>
          )}
          {mode === 'demo' && (
            <button
              className="btn small ghost"
              onClick={() => {
                demo.reset()
                setActor(demo.actor.key)
                refresh()
                setToast({ text: 'Demo reiniciada con los datos de ejemplo.' })
              }}
            >
              Reiniciar demo
            </button>
          )}
        </div>

        {loadError && (
          <div className="empty" role="alert">
            No se pudo leer la red: {loadError}
          </div>
        )}
        {!snap && !loadError && <div className="empty">Leyendo contratos…</div>}
        {snap && <Ctx.Provider value={{ api, snap, busy, run, go }}>{view}</Ctx.Provider>}
      </main>

      <footer>
        <span>
          Escomblock · proyecto estudiantil sobre escombro reciclado en mampostería · construido en Stellar + Soroban
        </span>
        <a href="https://github.com/S41ntx/escomblock" target="_blank" rel="noreferrer">
          Código fuente
        </a>
      </footer>

      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.hash && <TxLink hash={toast.hash} mode={api.mode} />}
        </div>
      )}
    </>
  )
}
