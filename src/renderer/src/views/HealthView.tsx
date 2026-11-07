import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HealthFinding, HealthReport, RestorePointResult } from '@shared/types'
import { api, isDemo } from '../api'
import { formatBytes } from '../format'
import { Icon } from '../components/Icon'
import type { Toast } from '../components/ui'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

const TONE: Record<HealthFinding['severity'], string> = { ok: 'info', info: 'info', warning: 'caution', critical: 'critical' }

export function HealthView({ notify }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const scan = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await api.healthScan())
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [notify, t])

  useEffect(() => {
    void scan()
  }, [scan])

  const restorePoint = async () => {
    setRestoring(true)
    try {
      announceRestorePoint(await api.restorePoint('manual'), notify, t, true)
    } finally {
      setRestoring(false)
    }
  }

  const isWin = window.repid?.platform === 'win32' || isDemo
  const days = report ? Math.floor(report.uptimeSec / 86400) : 0
  const hours = report ? Math.floor((report.uptimeSec % 86400) / 3600) : 0

  return (
    <div className="startup health">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="pulse" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('health.title')}</h2>
          <p>{loading && !report ? t('health.scanning') : t('health.intro')}</p>
        </div>
        <button className="btn btn--secondary" onClick={() => void scan()} disabled={loading}>
          <Icon name="refresh" size={16} /> {t('startup.rescan')}
        </button>
        {isWin && (
          <button className="btn btn--primary" onClick={() => void restorePoint()} disabled={restoring}>
            {restoring ? <span className="spinner spinner--sm" /> : <Icon name="undo" size={16} />} {t('health.restorePoint')}
          </button>
        )}
      </section>

      {report?.findings.map((f, i) => (
        <p key={i} className={`callout callout--${TONE[f.severity]}`}>
          <Icon name={f.severity === 'ok' ? 'check' : f.severity === 'info' ? 'info' : 'warning'} size={16} /> {t(`health.findings.${f.key}`, f.params)}
        </p>
      ))}
      {report && isWin && !report.elevated && !isDemo && <p className="callout callout--info"><Icon name="lock" size={16} /> {t('health.needsAdmin')}</p>}

      {report && (
        <div className="health-grid">
          {report.drives.map((d, i) => (
            <section key={i} className="auto-card">
              <header>
                <span className={`auto-card__icon health-dot health-dot--${d.status}`}><Icon name="disk" size={18} /></span>
                <div>
                  <h3>{d.name}</h3>
                  <p className="muted">{d.media} · {formatBytes(d.sizeBytes, lng)}</p>
                </div>
                <span className={`impact-pill impact-pill--${d.status === 'healthy' ? 'low' : d.status === 'unknown' ? 'not-running' : 'high'}`}>{t(`health.drive.${d.status}`)}</span>
              </header>
              <dl className="kv-grid kv-grid--2">
                <div><dt>{t('health.temp')}</dt><dd>{d.temperatureC !== undefined ? `${d.temperatureC} °C` : '—'}</dd></div>
                <div><dt>{t('health.wear')}</dt><dd>{d.wearPct !== undefined ? `${d.wearPct} %` : '—'}</dd></div>
                <div><dt>{t('health.hours')}</dt><dd>{d.powerOnHours !== undefined ? d.powerOnHours.toLocaleString(lng) : '—'}</dd></div>
                <div><dt>{t('health.errors')}</dt><dd>{d.readErrors ?? '—'}</dd></div>
              </dl>
            </section>
          ))}

          {report.battery && (
            <section className="auto-card">
              <header>
                <span className="auto-card__icon"><Icon name="bolt" size={18} /></span>
                <div>
                  <h3>{t('health.battery')}</h3>
                  <p className="muted">{report.battery.charging ? t('health.charging') : ''} {report.battery.percent !== undefined ? `${report.battery.percent} %` : ''}</p>
                </div>
              </header>
              <div className="meter" title={t('health.capacity')}>
                <span style={{ width: `${report.battery.capacityPct ?? 0}%` }} className={(report.battery.capacityPct ?? 100) < 80 ? 'meter--warn' : ''} />
              </div>
              <dl className="kv-grid kv-grid--2">
                <div><dt>{t('health.capacity')}</dt><dd>{report.battery.capacityPct !== undefined ? `${report.battery.capacityPct} %` : '—'}</dd></div>
                <div><dt>{t('health.cycles')}</dt><dd>{report.battery.cycles ?? '—'}</dd></div>
              </dl>
            </section>
          )}

          <section className="auto-card">
            <header>
              <span className="auto-card__icon"><Icon name="cpu" size={18} /></span>
              <div>
                <h3>{t('health.system')}</h3>
                <p className="muted">{t('health.uptime', { days, hours })}</p>
              </div>
            </header>
            <dl className="kv-grid kv-grid--2">
              <div><dt>{t('health.cpuTemp')}</dt><dd>{report.cpuTempC !== undefined ? `${Math.round(report.cpuTempC)} °C` : '—'}</dd></div>
              <div><dt>{t('health.gpuTemp')}</dt><dd>{report.gpuTempC !== undefined ? `${Math.round(report.gpuTempC)} °C` : '—'}</dd></div>
            </dl>
            {report.cpuTempC === undefined && <small className="muted">{t('health.noCpuTemp')}</small>}
          </section>

          <section className="auto-card auto-card--wide">
            <header>
              <span className="auto-card__icon"><Icon name="dashboard" size={18} /></span>
              <div>
                <h3>{t('health.space')}</h3>
              </div>
            </header>
            {report.volumes.map((v) => {
              const pct = v.sizeBytes ? (v.usedBytes / v.sizeBytes) * 100 : 0
              return (
                <div key={v.mount} className="volume">
                  <div className="volume__head">
                    <strong className="mono">{v.mount}</strong>
                    <span className="muted">{t('health.free', { free: formatBytes(v.sizeBytes - v.usedBytes, lng), total: formatBytes(v.sizeBytes, lng) })}</span>
                  </div>
                  <div className="meter"><span style={{ width: `${pct}%` }} className={pct >= 95 ? 'meter--crit' : pct >= 85 ? 'meter--warn' : ''} /></div>
                </div>
              )
            })}
          </section>
        </div>
      )}
    </div>
  )
}

/** Shared by the views that create a restore point before a delicate change. */
export function announceRestorePoint(
  res: RestorePointResult,
  notify: Props['notify'],
  t: (k: string, o?: Record<string, unknown>) => string,
  manual: boolean
): void {
  if (res.status === 'created') notify({ tone: 'success', title: t('health.restore.created') })
  else if (res.status === 'recent-exists') notify({ tone: 'info', title: t('health.restore.recent') })
  else if (res.status === 'disabled') notify({ tone: 'warning', title: t('health.restore.disabled') })
  else if (manual && res.status === 'needs-admin') notify({ tone: 'warning', title: t('health.restore.needsAdmin') })
  else if (manual && res.status === 'unsupported') notify({ tone: 'info', title: t('health.restore.unsupported') })
  else if (res.status === 'failed') notify({ tone: 'warning', title: t('health.restore.failed'), body: res.error })
}
