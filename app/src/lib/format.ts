const nf = (d: number) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtInt = (n: number) => nf(0).format(n)
export const fmtUsdc = (n: number) => `${nf(2).format(n)} USDC`
export const fmtEscb = (n: number) => `${nf(0).format(n)} ESCB`
export const fmtKg = (kg: number) =>
  kg >= 1000 ? `${nf(kg % 1000 === 0 ? 0 : 1).format(kg / 1000)} t` : `${nf(0).format(kg)} kg`
export const fmtMpa = (n: number) => `${nf(2).format(n)} MPa`
export const fmtPct = (n: number) => `${nf(1).format(n)} %`

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a)

export const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

export const fmtDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
