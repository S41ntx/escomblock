import { createContext, useContext } from 'react'
import { nameOf } from '../lib/demo'
import { NETWORK } from '../lib/config'
import { shortAddr } from '../lib/format'
import type { Api, BatchStatus, OrderStatus, Snapshot, TxResult } from '../lib/types'

export interface AppCtx {
  api: Api
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
  const name = a === you ? 'Tú' : nameOf(a)
  return (
    <span title={a}>
      {name ? `${name} ` : ''}
      <span className="mono muted">{shortAddr(a)}</span>
    </span>
  )
}

export function TxLink({ hash, mode }: { hash?: string; mode: Api['mode'] }) {
  if (!hash) return null
  if (mode === 'demo') return <span className="mono">tx simulada {hash.slice(0, 10)}…</span>
  return (
    <a className="mono" href={`${NETWORK.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      ver tx {hash.slice(0, 10)}… en Stellar Expert
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
  const { api } = useApp()
  return (
    <Empty>
      {role === 'Plant'
        ? 'Esta vista es para plantas registradas. '
        : 'Esta vista es para laboratorios registrados. '}
      {api.mode === 'demo'
        ? `Cambia de actor arriba a “${role === 'Plant' ? 'Planta Escomblock Hermosillo' : 'Laboratorio de Materiales'}”.`
        : 'Pide al administrador que registre tu cuenta con set_role.'}
    </Empty>
  )
}
