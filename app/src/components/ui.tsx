import { createContext, useContext } from 'react'
import { NETWORK } from '../lib/config'
import { shortAddr } from '../lib/format'
import type { SorobanApi } from '../lib/soroban'
import type { BatchStatus, OrderStatus, Snapshot, TxResult } from '../lib/types'

export interface AppCtx {
  api: SorobanApi
  snap: Snapshot
  busy: boolean
  run: (fn: () => Promise<TxResult>, ok: (r: TxResult) => string) => Promise<TxResult | undefined>
  go: (route: string) => void
}

export const Ctx = createContext<AppCtx | null>(null)
export const useApp = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Ctx missing')
  return c
}

const BATCH_LABEL: Record<BatchStatus, [string, string]> = {
  Pending: ['En laboratorio', 'warn'],
  Certified: ['Certificado', 'ok'],
  Rejected: ['Rechazado', 'bad'],
}
const ORDER_LABEL: Record<OrderStatus, [string, string]> = {
  Paid: ['Pagado en garantía', 'warn'],
  Shipped: ['Enviado', 'warn'],
  Completed: ['Entregado', 'ok'],
  Cancelled: ['Cancelado', ''],
}

export function BatchPill({ status }: { status: BatchStatus }) {
  const [text, cls] = BATCH_LABEL[status]
  return <span className={`pill ${cls}`}>{text}</span>
}

export function OrderPill({ status }: { status: OrderStatus }) {
  const [text, cls] = ORDER_LABEL[status]
  return <span className={`pill ${cls}`}>{text}</span>
}

export function Addr({ a, you }: { a: string; you?: string }) {
  return (
    <a className="addr" title={a} href={`${NETWORK.explorer}/account/${a}`} target="_blank" rel="noreferrer">
      {a === you ? 'Tú ' : ''}
      <span className="mono">{shortAddr(a)}</span>
    </a>
  )
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return null
  return (
    <a className="mono" href={`${NETWORK.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      ver transacción {hash.slice(0, 10)}…
    </a>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="section">{title}</h2>
      {children}
    </div>
  )
}

export function NeedRole({ role }: { role: 'Plant' | 'Lab' }) {
  const { api, snap, busy, run } = useApp()
  const acct = snap.account
  const name = role === 'Plant' ? 'planta' : 'laboratorio'
  if (snap.config.openRoles && acct) {
    const other = role === 'Plant' ? acct.roles.includes('Lab') : acct.roles.includes('Plant')
    return (
      <Empty>
        <p>
          Esta red de prueba está abierta: cualquiera puede probar Escomblock como {name}. Regístrate con un clic
          y firma en Freighter.
        </p>
        {other && (
          <p>
            Tu cuenta ya es {role === 'Plant' ? 'laboratorio' : 'planta'}. Puedes tener los dos roles, pero el
            contrato no deja que una cuenta certifique sus propios lotes: usa otra cuenta de Freighter para el
            {role === 'Plant' ? ' laboratorio' : ' otro rol'}.
          </p>
        )}
        <div className="btns" style={{ justifyContent: 'center' }}>
          <button
            className="btn primary"
            disabled={busy || !acct.funded}
            onClick={() => run(() => api.join(role), () => `Listo: tu cuenta ya es ${name}.`)}
          >
            Registrarme como {name}
          </button>
        </div>
        {!acct.funded && <p className="muted">Primero obtén XLM de prueba con el botón de la barra de wallet.</p>}
      </Empty>
    )
  }
  return (
    <Empty>
      {role === 'Plant'
        ? 'Esta vista es para plantas registradas. '
        : 'Esta vista es para laboratorios registrados. '}
      {acct
        ? 'Tu cuenta no tiene este rol: pide a Escomblock que la registre.'
        : snap.config.openRoles
          ? `Conecta tu wallet Freighter para registrarte como ${name} en esta red de prueba.`
          : 'Conecta la wallet de tu planta o laboratorio.'}
    </Empty>
  )
}
