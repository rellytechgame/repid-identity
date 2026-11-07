import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SystemSnapshot } from '@shared/types'
import { api } from './api'
import { formatRate } from './format'
import { Icon } from './components/Icon'
import { LogoMark } from './components/Logo'

/**
 * Compact always-on-top widget: live CPU/RAM/disk and one-tap actions. The
 * window frame is draggable; buttons opt out via the `no-drag` class. It polls
 * the same engine as the main window through `window.repid`.
 */
export function Widget() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [snap, setSnap] = useState<SystemSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const s = await api.snapshot()
        if (alive) setSnap(s)
      } catch {
        // engine busy; keep the last values
      }
    }
    void tick()
    const id = window.setInterval(() => {
      if (!document.hidden) void tick()
    }, 2000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const memPct = snap ? Math.round((snap.mem.used / snap.mem.total) * 100) : 0
  const cpu = snap ? Math.round(snap.cpu.load) : 0
  const disk = (snap?.diskRead ?? 0) + (snap?.diskWrite ?? 0)

  return (
    <div className="widget">
      <div className="widget__bar">
        <LogoMark size={16} />
        <span className="widget__title">RePID</span>
        <button className="widget__close no-drag" aria-label={t('common.close')} onClick={() => void api.quickAction('close-widget')}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="widget__stats">
        <Stat label="CPU" value={`${cpu}%`} pct={cpu} tone="cpu" />
        <Stat label="RAM" value={`${memPct}%`} pct={memPct} tone="mem" />
        <Stat label={t('nav.disk')} value={formatRate(disk, lng)} pct={Math.min(100, disk / (20 * 1024 * 1024) * 100)} tone="gpu" />
      </div>
      <div className="widget__actions no-drag">
        <button className="widget__btn widget__btn--primary" onClick={() => void api.quickAction('smart-free')}>
          <Icon name="bolt" size={13} /> {t('smart.cta')}
        </button>
        <button className="widget__btn" aria-label={t('nav.processes')} title={t('nav.processes')} onClick={() => void api.quickAction('open:processes')}>
          <Icon name="list" size={14} />
        </button>
        <button className="widget__btn" aria-label={t('common.open', { defaultValue: 'Open' })} title="RePID" onClick={() => void api.quickAction('open')}>
          <Icon name="external" size={14} />
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: 'cpu' | 'mem' | 'gpu' }) {
  return (
    <div className="widget__stat">
      <div className="widget__stat-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className={`widget__meter widget__meter--${tone}`}>
        <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  )
}
