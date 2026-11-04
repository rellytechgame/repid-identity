import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppGroup, Risk } from '@shared/types'
import { REPO_URL } from '@shared/constants'
import { api } from '../api'
import { hueOf } from '../format'
import { Icon, type IconName } from './Icon'

export function Gauge({ value, label, tone }: { value: number; label: string; tone: 'cpu' | 'mem' | 'gpu' }) {
  const r = 34
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <svg className={`gauge gauge--${tone}`} viewBox="0 0 84 84" role="img" aria-label={`${label}: ${Math.round(v)}%`}>
      <circle className="gauge__track" cx="42" cy="42" r={r} />
      <circle
        className="gauge__value"
        cx="42"
        cy="42"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v / 100)}
        transform="rotate(-90 42 42)"
      />
      <text x="42" y="47" textAnchor="middle" className="gauge__text">
        {Math.round(v)}
        <tspan className="gauge__unit">%</tspan>
      </text>
    </svg>
  )
}

export function Sparkline({ values, tone }: { values: number[]; tone: 'cpu' | 'mem' | 'gpu' }) {
  if (values.length < 2) return <div className="sparkline sparkline--empty" />
  const w = 160
  const h = 40
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.min(100, v) / 100) * (h - 2) - 1).toFixed(1)}`)
  return (
    <svg className={`sparkline sparkline--${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon className="sparkline__area" points={`0,${h} ${pts.join(' ')} ${w},${h}`} />
      <polyline className="sparkline__line" points={pts.join(' ')} />
    </svg>
  )
}

export function ImpactBar({ value }: { value: number }) {
  const level = value >= 60 ? 'high' : value >= 30 ? 'mid' : 'low'
  return (
    <div className={`impact impact--${level}`} title={`${value}/100`}>
      <div className="impact__fill" style={{ width: `${Math.max(3, value)}%` }} />
    </div>
  )
}

export function RiskBadge({ risk }: { risk: Risk }) {
  const { t } = useTranslation()
  if (risk === 'safe') return null
  return (
    <span className={`badge badge--${risk}`} title={t(`risk.${risk}Hint`)}>
      <Icon name={risk === 'critical' ? 'lock' : 'warning'} size={12} />
      {t(`risk.${risk}`)}
    </span>
  )
}

export function CategoryBadge({ category }: { category: AppGroup['identity']['category'] }) {
  const { t } = useTranslation()
  return <span className={`badge badge--cat badge--cat-${category}`}>{t(`categories.${category}`)}</span>
}

export function AppAvatar({ name, size = 34 }: { name: string; size?: number }) {
  const hue = hueOf(name)
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
      aria-hidden="true"
    >
      {name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'}
    </span>
  )
}

export function Modal({ title, icon, onClose, children, footer, wide }: {
  title: string
  icon?: IconName
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('button, input')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal__header">
          {icon && (
            <span className="modal__icon">
              <Icon name={icon} />
            </span>
          )}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  )
}

export interface Toast {
  id: number
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  body?: string
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <Icon name={toast.tone === 'success' ? 'check' : toast.tone === 'info' ? 'info' : 'warning'} />
          <div>
            <strong>{toast.title}</strong>
            {toast.body && <p>{toast.body}</p>}
          </div>
          <button className="icon-btn" onClick={() => dismiss(toast.id)} aria-label="×">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

let starCache: number | null = null

/** Live GitHub star count (public API, no token). Falls back to a plain button offline. */
export function StarButton({ compact }: { compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const [stars, setStars] = useState<number | null>(starCache)
  useEffect(() => {
    if (starCache !== null) return
    const repo = REPO_URL.replace('https://github.com/', '')
    fetch(`https://api.github.com/repos/${repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (typeof data?.stargazers_count === 'number') {
          starCache = data.stargazers_count
          setStars(data.stargazers_count)
        }
      })
      .catch(() => undefined)
  }, [])
  return (
    <button className={`star-btn ${compact ? 'star-btn--compact' : ''}`} onClick={() => void api.openRepo('')}>
      <Icon name="github" size={16} />
      <span>{t('common.star')}</span>
      <Icon name="star" size={14} className="star-btn__star" />
      {stars !== null && <span className="star-btn__count">{stars.toLocaleString(i18n.language)}</span>}
    </button>
  )
}
