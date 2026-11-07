import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateOutcome, UpdateReport } from '@shared/types'
import { api } from '../api'
import { useProgress } from '../hooks'
import { Icon } from '../components/Icon'
import { AppAvatar, type Toast } from '../components/ui'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

export function UpdatesView({ notify }: Props) {
  const { t, i18n } = useTranslation()
  const [report, setReport] = useState<UpdateReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Map<string, UpdateOutcome>>(new Map())
  const progress = useProgress(applying ? 'updates' : null)

  const scan = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.updatesScan()
      setReport(r)
      // Pre-select everything except major version jumps, which can change how an app (or its data) works.
      setPicked(new Set(r.updates.filter((u) => !u.major).map((u) => u.id)))
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [notify, t])

  useEffect(() => {
    void scan()
  }, [scan])

  const apply = async (ids: string[]) => {
    setApplying(true)
    try {
      const out = await api.updatesApply(ids)
      setResults((m) => new Map([...m, ...out.map((o) => [o.id, o] as const)]))
      const ok = out.filter((o) => o.status === 'updated').length
      const failed = out.length - ok
      notify({
        tone: ok && !failed ? 'success' : ok ? 'warning' : 'error',
        title: ok ? t('updates.toast.done', { count: ok }) : t('updates.toast.none'),
        body: failed ? t('updates.toast.failed', { count: failed }) : undefined
      })
      setPicked(new Set())
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setApplying(false)
    }
  }

  const updates = report?.updates ?? []
  const pending = updates.filter((u) => results.get(u.id)?.status !== 'updated')

  return (
    <div className="startup updates">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="download" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('updates.title')}</h2>
          <p>{loading ? t('updates.scanning') : report ? t('updates.summary', { count: pending.length }) : t('updates.intro')}</p>
        </div>
        <button className="btn btn--secondary" onClick={() => void scan()} disabled={loading || applying}>
          <Icon name="refresh" size={16} /> {t('startup.rescan')}
        </button>
        <button className="btn btn--primary btn--lg" disabled={!picked.size || applying || loading} onClick={() => void apply([...picked])}>
          <Icon name="download" size={16} /> {t('updates.apply', { count: picked.size })}
        </button>
      </section>

      <p className="callout callout--info"><Icon name="shield" size={16} /> {t(`updates.note.${window.repid?.platform ?? 'win32'}`, { defaultValue: t('updates.note.win32') })}</p>
      {report?.managerMissing && <p className="callout callout--caution">{t(`updates.missing.${window.repid?.platform ?? 'win32'}`, { defaultValue: t('updates.missing.win32') })}</p>}
      {report && !report.supported && <p className="callout callout--caution">{t('updates.unsupported')}</p>}

      {applying && (
        <div className="callout callout--info progress-callout">
          <span className="spinner spinner--sm" />
          <div>
            <strong>{t('updates.applying', { done: (progress?.done ?? 0) + 1, total: progress?.total ?? picked.size, name: progress?.current ?? '' })}</strong>
            {progress?.total ? <div className="progress"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div> : null}
            <small className="muted">{t('updates.applyingHint')}</small>
          </div>
        </div>
      )}

      {loading && !report && <div className="loading"><span className="spinner" /></div>}

      {report && (
        <section className="panel">
          <header className="panel__header">
            <h2><Icon name="package" size={16} /> {t('updates.listTitle', { count: pending.length })}</h2>
            <div className="orphan-tools">
              <button className="btn btn--ghost btn--sm" disabled={applying} onClick={() => setPicked(new Set(pending.map((u) => u.id)))}>{t('uninstall.orphans.selectAll')}</button>
              <button className="btn btn--ghost btn--sm" disabled={applying} onClick={() => setPicked(new Set())}>{t('uninstall.orphans.selectNone')}</button>
            </div>
          </header>
          {!updates.length && <p className="empty">{t('updates.allCurrent')}</p>}
          <ul className="startup-list">
            {updates.map((u) => {
              const res = results.get(u.id)
              return (
                <li key={u.id} className={`startup-row ${res?.status === 'updated' ? 'is-off' : ''}`}>
                  <AppAvatar name={u.name} size={36} />
                  <div className="startup-row__text">
                    <div className="startup-row__title">
                      <strong>{u.name}</strong>
                      {u.major && <span className="badge badge--caution" title={t('updates.majorHint')}><Icon name="warning" size={12} /> {t('updates.major')}</span>}
                      {res && <span className={`badge ${res.status === 'updated' ? 'badge--clean-safe' : 'badge--critical'}`}>{t(`updates.status.${res.status}`)}</span>}
                    </div>
                    <p className="startup-row__meta">
                      <span className="mono">{u.current || '?'}</span> → <strong className="mono">{u.available}</strong> · <span className="mono muted">{u.id}</span>
                    </p>
                    {res?.error && <p className="clean-row__note clean-row__note--warn">{res.error}</p>}
                  </div>
                  <div className="startup-row__side">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={picked.has(u.id)}
                        disabled={applying || res?.status === 'updated'}
                        aria-label={u.name}
                        onChange={(e) =>
                          setPicked((p) => {
                            const n = new Set(p)
                            if (e.target.checked) n.add(u.id)
                            else n.delete(u.id)
                            return n
                          })
                        }
                      />
                    </label>
                    <button className="btn btn--secondary btn--sm" disabled={applying || res?.status === 'updated'} onClick={() => void apply([u.id])}>
                      {t('updates.one')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {report && <p className="muted">{t('updates.lastScan', { date: new Date(report.scannedAt).toLocaleTimeString(i18n.language) })}</p>}
    </div>
  )
}
