import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InstalledApp, Leftover, LeftoverCleanResult, UninstallReport, UninstallResult } from '@shared/types'
import { readSetting } from '../hooks'
import { announceRestorePoint } from './HealthView'
import { api, isDemo } from '../api'
import { formatBytes } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, Modal, type Toast } from '../components/ui'

type Sort = 'name' | 'size' | 'date'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

export function UninstallView({ notify }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [report, setReport] = useState<UninstallReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('size')
  const [wizard, setWizard] = useState<InstalledApp | null>(null)
  const [orphans, setOrphans] = useState(false)

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await api.uninstallList())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  const apps = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (report?.apps ?? []).filter((a) => !q || `${a.name} ${a.publisher ?? ''}`.toLowerCase().includes(q))
    return [...list].sort((a, b) =>
      sort === 'size' ? (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) : sort === 'date' ? (b.installDate ?? '').localeCompare(a.installDate ?? '') : a.name.localeCompare(b.name)
    )
  }, [report, query, sort])
  const total = (report?.apps ?? []).reduce((s, a) => s + (a.sizeBytes ?? 0), 0)

  return (
    <div className="uninstall">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="package" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('uninstall.title')}</h2>
          <p>{!report && loading ? t('uninstall.scanning') : t('uninstall.summary', { count: report?.apps.length ?? 0, size: formatBytes(total, lng) })}</p>
        </div>
        <button className="btn btn--secondary" onClick={() => void scan()} disabled={loading}>
          <Icon name="refresh" size={16} /> {loading ? t('uninstall.scanning') : t('uninstall.rescan')}
        </button>
        <button className="btn btn--primary btn--lg" onClick={() => setOrphans(true)} disabled={!report?.supported}>
          <Icon name="broom" size={16} /> {t('uninstall.orphans.cta')}
        </button>
      </section>

      <p className="callout callout--info">
        <Icon name="shield" size={16} /> {t('uninstall.safeNote')}
      </p>
      {report && !report.supported && <p className="callout callout--caution">{t('uninstall.unsupported')}</p>}
      {report && window.repid?.platform === 'linux' && <p className="callout callout--info">{t('uninstall.linuxNote')}</p>}
      {report && window.repid?.platform === 'win32' && !report.elevated && !isDemo && (
        <div className="callout callout--caution clean-elevate">
          <Icon name="lock" size={16} />
          <span>{t('uninstall.notElevated')}</span>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.relaunchElevated()}>{t('settings.relaunchAdmin')}</button>
        </div>
      )}
      {error && <p className="callout callout--critical">{error}</p>}

      {report && (
        <section className="panel">
          <header className="panel__header uninstall-tools">
            <label className="search">
              <Icon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('uninstall.search')} aria-label={t('uninstall.search')} />
            </label>
            <div className="segmented" role="tablist" aria-label={t('uninstall.sortLabel')}>
              {(['size', 'name', 'date'] as Sort[]).map((s) => (
                <button key={s} role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
                  {t(`uninstall.sort.${s}`)}
                </button>
              ))}
            </div>
          </header>
          {!apps.length && <p className="empty">{t('uninstall.empty')}</p>}
          <ul className="startup-list">
            {apps.map((a) => (
              <AppRow key={a.id} app={a} onUninstall={() => setWizard(a)} />
            ))}
          </ul>
        </section>
      )}

      {orphans && (
        <OrphanModal
          notify={notify}
          onClose={() => {
            setOrphans(false)
            void scan()
          }}
        />
      )}

      {wizard && (
        <UninstallWizard
          app={wizard}
          notify={notify}
          onClose={() => {
            setWizard(null)
            void scan()
          }}
        />
      )}
    </div>
  )
}

function AppRow({ app: a, onUninstall }: { app: InstalledApp; onUninstall: () => void }) {
  const { t, i18n } = useTranslation()
  const locked = a.risk === 'critical'
  const meta = [a.publisher, a.version && `v${a.version}`, a.installDate && t('uninstall.installedOn', { date: new Date(a.installDate).toLocaleDateString(i18n.language) })].filter(Boolean).join(' · ')
  return (
    <li className={`startup-row ${locked ? 'is-locked' : ''}`}>
      <AppAvatar name={a.name} size={36} />
      <div className="startup-row__text">
        <div className="startup-row__title">
          <strong>{a.name}</strong>
          {locked && <span className="badge badge--critical" title={t(`uninstall.lockedHint.${a.kind}`)}><Icon name="lock" size={12} /> {t('startup.locked')}</span>}
          {a.risk === 'caution' && <span className="badge badge--caution" title={t(`uninstall.kindHint.${a.kind}`)}><Icon name="warning" size={12} /> {t(`uninstall.kind.${a.kind}`)}</span>}
          {a.source !== 'win32' && <span className="badge badge--cat">{t(`uninstall.source.${a.source}`)}</span>}
          {a.runningPids.length > 0 && <span className="badge badge--suggested">{t('uninstall.running')}</span>}
          {a.uninstallerMissing && <span className="badge badge--caution">{t('uninstall.broken')}</span>}
          {a.requiresAdmin && <span className="badge badge--admin"><Icon name="shield" size={12} /> {t('startup.admin')}</span>}
        </div>
        {meta && <p className="startup-row__meta">{meta}</p>}
        {a.installLocation && <p className="startup-row__cmd mono" title={a.installLocation}>{a.installLocation}</p>}
      </div>
      <div className="startup-row__side">
        <strong className="uninstall-size">{a.sizeBytes ? formatBytes(a.sizeBytes, i18n.language) : '—'}</strong>
        <button className="btn btn--danger-ghost btn--sm" disabled={locked} onClick={onUninstall} title={locked ? t(`uninstall.lockedHint.${a.kind}`) : undefined}>
          <Icon name="trash" size={14} /> {t('uninstall.action')}
        </button>
      </div>
    </li>
  )
}

type Step = 'confirm' | 'running' | 'leftovers' | 'cleaning' | 'done' | 'stopped'

const GROUPS: Array<{ id: string; kinds: Leftover['kind'][] }> = [
  { id: 'files', kinds: ['folder', 'file'] },
  { id: 'registry', kinds: ['registry-key', 'registry-value'] },
  { id: 'startup', kinds: ['shortcut', 'task'] }
]

function UninstallWizard({ app, notify, onClose }: { app: InstalledApp; notify: Props['notify']; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [step, setStep] = useState<Step>('confirm')
  const [closeRunning, setCloseRunning] = useState(true)
  const [ack, setAck] = useState(false)
  const [quiet, setQuiet] = useState(false)
  const [result, setResult] = useState<UninstallResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [cleaned, setCleaned] = useState<LeftoverCleanResult | null>(null)
  const name = app.name
  const busy = step === 'running' || step === 'cleaning'
  const needsAck = app.risk === 'caution' || app.uninstallerMissing

  const receive = (res: UninstallResult) => {
    setResult(res)
    if (res.status === 'uninstalled') {
      setPicked(new Set(res.leftovers.filter((l) => l.confidence === 'high').map((l) => l.id)))
      setStep('leftovers')
    } else setStep('stopped')
  }

  const start = async () => {
    setStep('running')
    try {
      // Windows restore point first (needs admin; skipped silently otherwise): undoes registry/driver changes of the uninstaller.
      if (!app.uninstallerMissing && readSetting('restorePoints') && !isDemo) announceRestorePoint(await api.restorePoint('uninstall'), notify, t, false)
      receive(
        app.uninstallerMissing
          ? await api.uninstallForceScan(app.id)
          : await api.uninstallRun({ id: app.id, mode: quiet ? 'quiet' : 'standard', closeRunning, allowCaution: ack })
      )
    } catch (err) {
      setResult({ id: app.id, status: 'uninstaller-failed', error: err instanceof Error ? err.message : String(err), leftovers: [] })
      setStep('stopped')
    }
  }

  const clean = async () => {
    if (!result) return
    setStep('cleaning')
    try {
      const res = await api.uninstallClean({ appId: app.id, ids: [...picked] })
      setCleaned(res)
      setStep('done')
      const removed = res.outcomes.filter((o) => o.status === 'removed' || o.status === 'gone').length
      notify({ tone: removed === res.outcomes.length ? 'success' : 'warning', title: t('uninstall.toast.done', { name, count: removed }) })
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
      setStep('leftovers')
    }
  }

  const leftovers = result?.leftovers ?? []
  const pickedSize = leftovers.filter((l) => picked.has(l.id)).reduce((s, l) => s + l.sizeBytes, 0)
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const footer =
    step === 'confirm' ? (
      <>
        <button className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn--danger" disabled={needsAck && !ack} onClick={() => void start()}>
          <Icon name="trash" size={16} /> {app.uninstallerMissing ? t('uninstall.wizard.forceAction') : t('uninstall.wizard.start')}
        </button>
      </>
    ) : step === 'leftovers' ? (
      <>
        <span className="modal__summary">{t('uninstall.wizard.selected', { count: picked.size, size: formatBytes(pickedSize, lng) })}</span>
        <button className="btn btn--ghost" onClick={onClose}>{t('uninstall.wizard.keep')}</button>
        <button className="btn btn--primary" disabled={!picked.size} onClick={() => void clean()}>
          <Icon name="broom" size={16} /> {t('uninstall.wizard.removeLeftovers')}
        </button>
      </>
    ) : step === 'done' || step === 'stopped' ? (
      <>
        {cleaned?.backupDir && (
          <button className="btn btn--secondary" onClick={() => void api.uninstallOpenBackups()}>
            <Icon name="external" size={14} /> {t('uninstall.wizard.openBackups')}
          </button>
        )}
        <button className="btn btn--primary" onClick={onClose}>{t('common.close')}</button>
      </>
    ) : undefined

  return (
    <Modal title={t('uninstall.wizard.title', { name })} icon="package" wide onClose={busy ? () => undefined : onClose} footer={footer}>
      <ol className="wizard-steps" aria-hidden="true">
        {['confirm', 'running', 'leftovers', 'done'].map((s, i) => {
          const order = ['confirm', 'running', 'leftovers', 'done']
          const current = order.indexOf(step === 'cleaning' ? 'leftovers' : step === 'stopped' ? 'done' : step)
          return <li key={s} className={i < current ? 'is-done' : i === current ? 'is-current' : ''}>{t(`uninstall.wizard.steps.${s}`)}</li>
        })}
      </ol>

      {step === 'confirm' && (
        <>
          <p>{app.uninstallerMissing ? t('uninstall.wizard.missingBody', { name }) : t(`uninstall.wizard.body.${app.source}`, { name })}</p>
          <ul className="wizard-points">
            <li><Icon name="check" size={14} /> {t('uninstall.wizard.point1')}</li>
            <li><Icon name="check" size={14} /> {t('uninstall.wizard.point2')}</li>
            <li><Icon name="check" size={14} /> {t('uninstall.wizard.point3')}</li>
          </ul>
          {app.runningPids.length > 0 && !app.uninstallerMissing && (
            <label className="checkbox callout callout--caution">
              <input type="checkbox" checked={closeRunning} onChange={(e) => setCloseRunning(e.target.checked)} />
              <span>
                {t('uninstall.wizard.closeRunning', { count: app.runningPids.length })}
                <br />
                <small>{t('cleaner.confirm.closeBlockingHint')}</small>
              </span>
            </label>
          )}
          {app.hasQuiet && !app.uninstallerMissing && (app.source === 'win32' || app.source === 'msi') && (
            <label className="checkbox">
              <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
              <span>
                {t('uninstall.wizard.quiet')}
                <br />
                <small className="muted">{t('uninstall.wizard.quietHint')}</small>
              </span>
            </label>
          )}
          {needsAck && (
            <div className="callout callout--critical clean-ack">
              <Icon name="warning" size={16} />
              <div>
                <strong>{app.uninstallerMissing ? t('uninstall.wizard.missingTitle') : t(`uninstall.kindHint.${app.kind}`)}</strong>
                <label className="checkbox">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  {t('uninstall.wizard.ack')}
                </label>
              </div>
            </div>
          )}
        </>
      )}

      {step === 'running' && (
        <div className="wizard-wait">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>{app.uninstallerMissing ? t('uninstall.wizard.scanning') : t('uninstall.wizard.running', { name })}</strong>
            <p className="muted">{app.uninstallerMissing ? '' : t('uninstall.wizard.runningHint')}</p>
          </div>
        </div>
      )}

      {(step === 'leftovers' || step === 'cleaning') && (
        <>
          {leftovers.length === 0 ? (
            <p className="callout callout--info"><Icon name="check" size={16} /> {t('uninstall.wizard.noLeftovers', { name })}</p>
          ) : (
            <>
              <p>{t('uninstall.wizard.leftoversBody', { count: leftovers.length, size: formatBytes(leftovers.reduce((s, l) => s + l.sizeBytes, 0), lng) })}</p>
              <p className="callout callout--info"><Icon name="undo" size={16} /> {t('uninstall.wizard.recoverable')}</p>
              <LeftoverList leftovers={leftovers} picked={picked} disabled={step === 'cleaning'} onToggle={toggle} />
            </>
          )}
          {leftovers.length === 0 && (
            <div className="wizard-actions">
              <button className="btn btn--primary" onClick={onClose}>{t('common.close')}</button>
            </div>
          )}
        </>
      )}

      {step === 'done' && cleaned && <CleanSummary result={cleaned} />}

      {step === 'stopped' && result && (
        <p className={`callout ${result.status === 'cancelled' || result.status === 'still-installed' ? 'callout--info' : 'callout--caution'}`}>
          <Icon name={result.status === 'cancelled' || result.status === 'still-installed' ? 'info' : 'warning'} size={16} />
          <span>
            {t(`uninstall.status.${result.status}`, { name })}
            {result.error && result.error !== 'missing' && <><br /><small className="mono">{result.error}</small></>}
          </span>
        </p>
      )}
    </Modal>
  )
}

function LeftoverList({ leftovers, picked, disabled, onToggle }: { leftovers: Leftover[]; picked: Set<string>; disabled: boolean; onToggle: (id: string, on: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  return (
    <>
      {GROUPS.map((g) => {
        const items = leftovers.filter((l) => g.kinds.includes(l.kind))
        if (!items.length) return null
        return (
          <section key={g.id} className="leftover-group">
            <h3>{t(`uninstall.groups.${g.id}`)} <span className="muted">({items.length})</span></h3>
            <ul className="leftover-list">
              {items.map((l) => (
                <li key={l.id}>
                  <label>
                    <input type="checkbox" checked={picked.has(l.id)} disabled={disabled} onChange={(e) => onToggle(l.id, e.target.checked)} />
                    <span className="leftover-list__text">
                      <span className="mono break">{l.location}</span>
                      <small className="muted">
                        {t(`uninstall.reason.${l.reason}`)}
                        {l.lastModified && <> · {t('uninstall.orphans.idle', { count: Math.max(1, Math.round((Date.now() - l.lastModified) / 864e5)) })}</>}
                        {l.confidence === 'medium' && <> · <span className="leftover-medium">{t(l.reason === 'orphan' ? 'uninstall.orphans.review' : 'uninstall.medium')}</span></>}
                      </small>
                    </span>
                    <span className="leftover-list__size">{l.sizeBytes ? formatBytes(l.sizeBytes, lng) : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

/** Leftovers of apps that are already uninstalled: scan → review → remove → summary. */
function OrphanModal({ notify, onClose }: { notify: Props['notify']; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [step, setStep] = useState<'scanning' | 'review' | 'cleaning' | 'done'>('scanning')
  const [leftovers, setLeftovers] = useState<Leftover[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [cleaned, setCleaned] = useState<LeftoverCleanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .uninstallScanOrphans()
      .then((res) => {
        if (!alive) return
        setLeftovers(res.leftovers)
        setPicked(new Set(res.leftovers.filter((l) => l.confidence === 'high').map((l) => l.id)))
        setStep('review')
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setStep('review')
      })
    return () => {
      alive = false
    }
  }, [])

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const total = leftovers.reduce((s, l) => s + l.sizeBytes, 0)
  const pickedSize = leftovers.filter((l) => picked.has(l.id)).reduce((s, l) => s + l.sizeBytes, 0)

  const clean = async () => {
    setStep('cleaning')
    try {
      const res = await api.uninstallClean({ appId: 'orphans', ids: [...picked] })
      setCleaned(res)
      setStep('done')
      notify({ tone: 'success', title: t('uninstall.orphans.toast', { count: res.outcomes.filter((o) => o.status === 'removed' || o.status === 'gone').length, size: formatBytes(res.recycledBytes, lng) }) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('review')
    }
  }

  const footer =
    step === 'review' && leftovers.length ? (
      <>
        <span className="modal__summary">{t('uninstall.wizard.selected', { count: picked.size, size: formatBytes(pickedSize, lng) })}</span>
        <button className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn--primary" disabled={!picked.size} onClick={() => void clean()}>
          <Icon name="broom" size={16} /> {t('uninstall.wizard.removeLeftovers')}
        </button>
      </>
    ) : step === 'done' || (step === 'review' && !leftovers.length) ? (
      <>
        {cleaned?.backupDir && (
          <button className="btn btn--secondary" onClick={() => void api.uninstallOpenBackups()}>
            <Icon name="external" size={14} /> {t('uninstall.wizard.openBackups')}
          </button>
        )}
        <button className="btn btn--primary" onClick={onClose}>{t('common.close')}</button>
      </>
    ) : undefined

  return (
    <Modal title={t('uninstall.orphans.title')} icon="broom" wide onClose={step === 'cleaning' ? () => undefined : onClose} footer={footer}>
      {step === 'scanning' && (
        <div className="wizard-wait">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>{t('uninstall.orphans.scanning')}</strong>
            <p className="muted">{t('uninstall.orphans.scanningHint')}</p>
          </div>
        </div>
      )}
      {error && <p className="callout callout--critical">{error}</p>}
      {(step === 'review' || step === 'cleaning') && !error && (
        leftovers.length === 0 ? (
          <p className="callout callout--info"><Icon name="check" size={16} /> {t('uninstall.orphans.none')}</p>
        ) : (
          <>
            <p>{t('uninstall.orphans.body', { count: leftovers.length, size: formatBytes(total, lng) })}</p>
            <p className="callout callout--info"><Icon name="shield" size={16} /> {t('uninstall.orphans.how')}</p>
            <div className="orphan-tools">
              <button className="btn btn--ghost btn--sm" disabled={step === 'cleaning'} onClick={() => setPicked(new Set(leftovers.map((l) => l.id)))}>{t('uninstall.orphans.selectAll')}</button>
              <button className="btn btn--ghost btn--sm" disabled={step === 'cleaning'} onClick={() => setPicked(new Set(leftovers.filter((l) => l.confidence === 'high').map((l) => l.id)))}>{t('uninstall.orphans.selectSafe')}</button>
              <button className="btn btn--ghost btn--sm" disabled={step === 'cleaning'} onClick={() => setPicked(new Set())}>{t('uninstall.orphans.selectNone')}</button>
            </div>
            <LeftoverList leftovers={leftovers} picked={picked} disabled={step === 'cleaning'} onToggle={toggle} />
          </>
        )
      )}
      {step === 'done' && cleaned && <CleanSummary result={cleaned} />}
    </Modal>
  )
}

function CleanSummary({ result }: { result: LeftoverCleanResult }) {
  const { t, i18n } = useTranslation()
  const n = (s: string) => result.outcomes.filter((o) => o.status === s).length
  return (
    <div className="wizard-done">
      <span className="wizard-done__icon"><Icon name="check" size={28} /></span>
      <div>
        <strong>{t('uninstall.wizard.doneTitle', { count: n('removed') + n('gone') })}</strong>
        <p className="muted">{t('uninstall.wizard.doneBody', { size: formatBytes(result.recycledBytes, i18n.language) })}</p>
        {n('needs-admin') > 0 && <p className="callout callout--caution">{t('uninstall.wizard.doneAdmin', { count: n('needs-admin') })}</p>}
        {n('failed') > 0 && <p className="callout callout--caution">{t('uninstall.wizard.doneFailed', { count: n('failed') })}</p>}
        {result.backupDir && <p className="muted">{t('uninstall.wizard.backupNote')}</p>}
      </div>
    </div>
  )
}
