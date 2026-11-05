import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StartupChangeOutcome, StartupEntry, StartupImpact, StartupReport } from '@shared/types'
import { api, isDemo } from '../api'
import { formatBytes, formatPercent } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, Modal, type Toast } from '../components/ui'

type Filter = 'all' | 'suggested' | 'enabled' | 'disabled'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

const IMPACT_ORDER: Record<StartupImpact, number> = { high: 0, medium: 1, low: 2, 'not-running': 3 }

/** Enabled first, then by measured impact, then name; locked OS components last. */
function sortEntries(a: StartupEntry, b: StartupEntry): number {
  return (
    Number(a.risk === 'critical') - Number(b.risk === 'critical') ||
    Number(b.enabled) - Number(a.enabled) ||
    IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact] ||
    (b.running?.memBytes ?? 0) - (a.running?.memBytes ?? 0) ||
    a.name.localeCompare(b.name)
  )
}

export function StartupView({ notify }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [report, setReport] = useState<StartupReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<StartupEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await api.startupScan())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  const entries = useMemo(() => [...(report?.entries ?? [])].sort(sortEntries), [report])
  const enabled = entries.filter((e) => e.enabled)
  const suggested = entries.filter((e) => e.recommended)
  const byRepid = entries.filter((e) => e.changedByRepid)
  const usingNow = enabled.reduce((s, e) => s + (e.running?.memBytes ?? 0), 0)
  const visible = entries.filter((e) =>
    filter === 'suggested' ? e.recommended : filter === 'enabled' ? e.enabled : filter === 'disabled' ? !e.enabled : true
  )

  const announce = (outcomes: StartupChangeOutcome[], kind: 'disabled' | 'enabled' | 'restored') => {
    const n = (s: StartupChangeOutcome['status']) => outcomes.filter((o) => o.status === s).length
    const changed = outcomes.filter((o) => o.status === 'changed')
    const notes = [
      n('needs-admin') ? t('startup.toast.needsAdmin', { count: n('needs-admin') }) : '',
      n('protected') ? t('startup.toast.protected', { count: n('protected') }) : '',
      n('failed') + n('not-found') ? t('startup.toast.failed', { count: n('failed') + n('not-found') }) : '',
      n('cancelled') ? t('startup.toast.cancelled') : ''
    ].filter(Boolean)
    notify({
      tone: changed.length && !notes.length ? 'success' : changed.length ? 'warning' : notes.length ? 'error' : 'info',
      title: changed.length ? t(`startup.toast.${kind}`, { count: changed.length, name: changed[0].name }) : t('startup.toast.nothing'),
      body: [changed.length && kind === 'disabled' ? t('startup.nextBoot') : '', ...notes].filter(Boolean).join(' ') || undefined
    })
  }

  const change = async (list: StartupEntry[], on: boolean, allowCaution: boolean) => {
    setConfirm(null)
    setBusy((b) => new Set([...b, ...list.map((e) => e.id)]))
    try {
      const out = await api.startupSet({ ids: list.map((e) => e.id), enabled: on, allowCaution })
      announce(out, on ? 'enabled' : 'disabled')
      await scan()
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(new Set())
    }
  }

  const restoreAll = async () => {
    setBusy(new Set(byRepid.map((e) => e.id)))
    try {
      announce(await api.startupRestore(), 'restored')
      await scan()
    } finally {
      setBusy(new Set())
    }
  }

  // Safe entries toggle immediately (one click undoes it); caution entries always go through the warning dialog.
  const toggle = (e: StartupEntry, on: boolean) => {
    if (!on && e.risk === 'caution') setConfirm([e])
    else void change([e], on, e.risk === 'caution')
  }

  const isWin = window.repid?.platform === 'win32'

  return (
    <div className="startup">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="power" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('startup.title')}</h2>
          <p>{!report && loading ? t('startup.scanning') : t('startup.summary', { enabled: enabled.length, mem: formatBytes(usingNow, lng) })}</p>
        </div>
        <button className="btn btn--secondary" onClick={() => void scan()} disabled={loading || busy.size > 0}>
          <Icon name="refresh" size={16} /> {t('startup.rescan')}
        </button>
        <button className="btn btn--primary btn--lg" disabled={!suggested.length || busy.size > 0} onClick={() => setConfirm(suggested)}>
          <Icon name="power" size={16} /> {t('startup.disableSuggested', { count: suggested.length })}
        </button>
      </section>

      <p className="callout callout--info">
        <Icon name="shield" size={16} /> {t('startup.safeNote')}
      </p>
      {report && !report.supported && <p className="callout callout--caution">{t('startup.unsupported')}</p>}
      {report && isWin && !report.elevated && !isDemo && entries.some((e) => e.requiresAdmin) && (
        <div className="callout callout--caution clean-elevate">
          <Icon name="lock" size={16} />
          <span>{t('startup.notElevatedWin')}</span>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.relaunchElevated()}>{t('settings.relaunchAdmin')}</button>
        </div>
      )}
      {error && <p className="callout callout--critical">{error}</p>}

      {byRepid.length > 0 && (
        <div className="callout callout--info startup-history">
          <Icon name="undo" size={16} />
          <span>
            <strong>{t('startup.history.title')}</strong> · {t('startup.history.body', { count: byRepid.length })}
          </span>
          <button className="btn btn--secondary btn--sm" onClick={() => void restoreAll()} disabled={busy.size > 0}>
            <Icon name="undo" size={14} /> {t('startup.history.restore')}
          </button>
        </div>
      )}

      {report && (
        <section className="panel">
          <header className="panel__header">
            <div className="segmented" role="tablist">
              {(['all', 'suggested', 'enabled', 'disabled'] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
                  {t(`startup.filters.${f}`)}
                  <span className="segmented__count">
                    {f === 'all' ? entries.length : f === 'suggested' ? suggested.length : f === 'enabled' ? enabled.length : entries.length - enabled.length}
                  </span>
                </button>
              ))}
            </div>
          </header>
          {!visible.length && <p className="empty">{t('startup.empty')}</p>}
          <ul className="startup-list">
            {visible.map((e) => (
              <StartupRow key={e.id} entry={e} busy={busy.has(e.id)} onToggle={(on) => toggle(e, on)} />
            ))}
          </ul>
        </section>
      )}

      {confirm && <ConfirmDisable entries={confirm} onCancel={() => setConfirm(null)} onConfirm={(ack) => void change(confirm, false, ack)} />}
    </div>
  )
}

function StartupRow({ entry: e, busy, onToggle }: { entry: StartupEntry; busy: boolean; onToggle: (on: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const locked = e.risk === 'critical'
  return (
    <li className={`startup-row ${e.enabled ? '' : 'is-off'} ${locked ? 'is-locked' : ''}`}>
      <AppAvatar name={e.name} size={36} />
      <div className="startup-row__text">
        <div className="startup-row__title">
          <strong>{e.name}</strong>
          {e.recommended && <span className="badge badge--suggested" title={t('startup.suggestedHint')}><Icon name="sparkles" size={12} /> {t('startup.suggested')}</span>}
          {locked && <span className="badge badge--critical" title={t('startup.lockedHint')}><Icon name="lock" size={12} /> {t('startup.locked')}</span>}
          {e.risk === 'caution' && <span className="badge badge--caution"><Icon name="warning" size={12} /> {t('risk.caution')}</span>}
          {e.requiresAdmin && <span className="badge badge--admin" title={t('startup.adminHint')}><Icon name="shield" size={12} /> {t('startup.admin')}</span>}
          {e.changedByRepid && <span className="badge badge--repid">{t('startup.changedByRepid')}</span>}
        </div>
        <p className="startup-row__meta">
          {[e.publisher, t(`startup.source.${e.source}`)].filter(Boolean).join(' · ')}
        </p>
        {!locked && (
          <p className="clean-row__effect">
            <span className="clean-row__what">{t('startup.whatHappens')}</span> {t(`startup.effect.${e.effect}`)}
          </p>
        )}
        <p className="startup-row__cmd mono" title={e.command}>{e.command}</p>
      </div>
      <div className="startup-row__side">
        {e.enabled ? (
          <span className={`impact-pill impact-pill--${e.impact}`} title={t('startup.impactHint')}>
            {t(`startup.impact.${e.impact}`)}
          </span>
        ) : (
          <span className="impact-pill impact-pill--off">{t('startup.disabledState')}</span>
        )}
        {e.running && <small className="muted">{t('startup.usingNow', { mem: formatBytes(e.running.memBytes, i18n.language), cpu: formatPercent(e.running.cpu, i18n.language) })}</small>}
        <label className="switch" title={locked ? t('startup.lockedHint') : undefined}>
          <input
            type="checkbox"
            checked={e.enabled}
            disabled={locked || busy}
            aria-label={t(e.enabled ? 'startup.toggleOff' : 'startup.toggleOn', { name: e.name })}
            onChange={(ev) => onToggle(ev.target.checked)}
          />
          <span className="switch__track" />
        </label>
      </div>
    </li>
  )
}

function ConfirmDisable({ entries, onCancel, onConfirm }: { entries: StartupEntry[]; onCancel: () => void; onConfirm: (ack: boolean) => void }) {
  const { t } = useTranslation()
  const caution = entries.filter((e) => e.risk === 'caution')
  const [ack, setAck] = useState(false)
  return (
    <Modal
      title={t('startup.confirm.title')}
      icon="power"
      wide
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className={`btn ${caution.length ? 'btn--danger' : 'btn--primary'}`} disabled={caution.length > 0 && !ack} onClick={() => onConfirm(ack)}>
            <Icon name="power" size={16} /> {t('startup.confirm.action', { count: entries.length })}
          </button>
        </>
      }
    >
      <p>{t('startup.confirm.body')}</p>
      <ul className="confirm-clean-list">
        {entries.map((e) => (
          <li key={e.id} className={`confirm-clean-list__item confirm-clean-list__item--${e.risk === 'caution' ? 'caution' : 'safe'}`}>
            <div>
              <strong>{e.name}</strong>
              <p>{t(`startup.effect.${e.effect}`)}</p>
            </div>
          </li>
        ))}
      </ul>
      {caution.length > 0 && (
        <div className="callout callout--caution clean-ack">
          <Icon name="warning" size={16} />
          <div>
            <strong>{t('startup.confirm.cautionTitle')}</strong>
            <ul>
              {caution.map((e) => (
                <li key={e.id}>{e.name}</li>
              ))}
            </ul>
            <label className="checkbox">
              <input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} />
              {t('startup.confirm.cautionAck')}
            </label>
          </div>
        </div>
      )}
      <p className="muted">{t('startup.nextBoot')}</p>
    </Modal>
  )
}
