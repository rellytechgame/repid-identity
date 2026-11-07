import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CleanOutcome, CleanResult, CleanerReport, CleanerTarget } from '@shared/types'
import { api, isDemo } from '../api'
import { readSetting } from '../hooks'
import { formatBytes } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, Modal } from '../components/ui'

interface Props {
  onResult: (result: CleanResult, report: CleanerReport) => void
}

const GROUPS: Array<CleanerTarget['group']> = ['system', 'browsers', 'apps']

function RiskTag({ risk }: { risk: CleanerTarget['risk'] }) {
  const { t } = useTranslation()
  return <span className={`badge badge--clean-${risk}`}>{t(`cleaner.risk.${risk}`)}</span>
}

export function CleanerView({ onResult }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [report, setReport] = useState<CleanerReport | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [lastOutcomes, setLastOutcomes] = useState<Map<string, CleanOutcome>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async (keepSelection = false) => {
    setScanning(true)
    setError(null)
    try {
      const r = await api.cleanerScan()
      setReport(r)
      if (!keepSelection) setSelected(new Set(r.targets.filter((x) => x.available && x.defaultSelected).map((x) => x.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  const chosen = useMemo(() => report?.targets.filter((x) => selected.has(x.id) && x.available) ?? [], [report, selected])
  const total = chosen.reduce((s, x) => s + x.sizeBytes, 0)
  const recoverable = report?.targets.filter((x) => x.available).reduce((s, x) => s + x.sizeBytes, 0) ?? 0

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const runClean = async (closeBlocking: boolean, acknowledgedSensitive: boolean) => {
    if (!report) return
    setConfirming(false)
    setCleaning(true)
    try {
      // Removing Windows.old ends the way back to the previous Windows: take a restore point first when possible.
      if (chosen.some((x) => x.id === 'windows-old') && readSetting('restorePoints') && !isDemo) await api.restorePoint('cleanup').catch(() => undefined)
      const result = await api.cleanerClean({ ids: chosen.map((x) => x.id), closeBlocking, acknowledgedSensitive })
      setLastOutcomes(new Map(result.outcomes.map((o) => [o.id, o])))
      onResult(result, report)
      await scan(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCleaning(false)
    }
  }

  const title = (x: CleanerTarget) => t(`cleaner.items.${x.kind}.title`)

  const renderRow = (x: CleanerTarget) => {
    const outcome = lastOutcomes.get(x.id)
    const needsAdmin = x.requiresAdmin && report && !report.elevated && !isDemo
    return (
      <li key={x.id} className={`clean-row ${x.available ? '' : 'is-disabled'}`}>
        <label className="clean-row__main">
          <input type="checkbox" disabled={!x.available || cleaning} checked={selected.has(x.id) && x.available} onChange={(e) => toggle(x.id, e.target.checked)} />
          <div className="clean-row__text">
            <div className="clean-row__title">
              <strong>{title(x)}</strong>
              <RiskTag risk={x.risk} />
              {x.requiresAdmin && (
                <span className="badge badge--admin" title={t('cleaner.adminHint')}>
                  <Icon name="shield" size={12} /> {t('cleaner.admin')}
                </span>
              )}
            </div>
            <p className="clean-row__effect">
              <span className="clean-row__what">{t('cleaner.whatHappens')}</span> {t(`cleaner.items.${x.kind}.effect`)}
            </p>
            {!x.available && x.unavailableReason && <p className="clean-row__note">{t(`cleaner.unavailable.${x.unavailableReason}`)}</p>}
            {x.available && x.blockedBy.length > 0 && (
              <p className="clean-row__note clean-row__note--warn">
                <Icon name="warning" size={13} /> {t('cleaner.blockedBy', { names: x.blockedBy.join(', ') })}
              </p>
            )}
            {needsAdmin && <p className="clean-row__note">{t('cleaner.needsAdminNote')}</p>}
            {outcome && <p className={`clean-row__result clean-row__result--${outcome.status}`}>{t(`cleaner.status.${outcome.status}`, { size: formatBytes(outcome.freedBytes, lng), skipped: outcome.skipped })}</p>}
          </div>
        </label>
        <span className="clean-row__size">
          {x.measurable ? (x.available ? formatBytes(x.sizeBytes, lng) : '—') : t('cleaner.notMeasurable')}
          {x.measurable && x.itemCount > 0 && <small>{t('cleaner.items_count', { count: x.itemCount })}</small>}
        </span>
      </li>
    )
  }

  return (
    <div className="cleaner">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="broom" size={26} /></span>
        <div className="clean-hero__text">
          <h2>{t('cleaner.title')}</h2>
          <p>{scanning && !report ? t('cleaner.scanning') : t('cleaner.recoverable', { size: formatBytes(recoverable, lng) })}</p>
        </div>
        <button className="btn btn--secondary" onClick={() => void scan(true)} disabled={scanning || cleaning}>
          <Icon name="refresh" size={16} /> {scanning ? t('cleaner.scanning') : t('cleaner.rescan')}
        </button>
        <button className="btn btn--primary btn--lg" disabled={!chosen.length || cleaning || scanning} onClick={() => setConfirming(true)}>
          <Icon name="broom" size={16} /> {cleaning ? t('cleaner.cleaning') : t('cleaner.cleanSelected', { size: formatBytes(total, lng) })}
        </button>
      </section>

      <p className="callout callout--info">
        <Icon name="shield" size={16} /> {t('cleaner.preserved')}
      </p>
      {report && !report.elevated && !isDemo && (
        <div className="callout callout--caution clean-elevate">
          <Icon name="lock" size={16} />
          <span>{t(window.repid?.platform === 'win32' ? 'cleaner.notElevatedWin' : 'cleaner.notElevatedUnix')}</span>
          {window.repid?.platform === 'win32' && (
            <button className="btn btn--secondary btn--sm" onClick={() => void api.relaunchElevated()}>
              {t('settings.relaunchAdmin')}
            </button>
          )}
        </div>
      )}
      {error && <p className="callout callout--critical">{error}</p>}

      {report &&
        GROUPS.map((group) => {
          const rows = report.targets.filter((x) => x.group === group)
          if (!rows.length) return null
          if (group !== 'browsers') {
            return (
              <section key={group} className="panel clean-group">
                <header className="panel__header"><h2>{t(`cleaner.groups.${group}`)}</h2></header>
                <ul className="clean-list">{rows.map(renderRow)}</ul>
              </section>
            )
          }
          const browsers = [...new Set(rows.map((x) => x.browser ?? ''))]
          return (
            <section key={group} className="panel clean-group">
              <header className="panel__header">
                <h2>{t('cleaner.groups.browsers')}</h2>
                <span className="muted">{t('cleaner.browsersFound', { count: browsers.length })}</span>
              </header>
              {browsers.map((b) => {
                const items = rows.filter((x) => x.browser === b)
                const open = items.some((x) => x.blockedBy.length)
                return (
                  <div key={b} className="clean-browser">
                    <div className="clean-browser__head">
                      <AppAvatar name={b} size={26} />
                      <strong>{b}</strong>
                      {open && <span className="badge badge--caution">{t('cleaner.open')}</span>}
                    </div>
                    <ul className="clean-list">{items.map(renderRow)}</ul>
                  </div>
                )
              })}
            </section>
          )
        })}

      {confirming && report && <CleanConfirm targets={chosen} onCancel={() => setConfirming(false)} onConfirm={runClean} />}
    </div>
  )
}

function CleanConfirm({ targets, onCancel, onConfirm }: {
  targets: CleanerTarget[]
  onCancel: () => void
  onConfirm: (closeBlocking: boolean, acknowledgedSensitive: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const sensitive = targets.filter((x) => x.risk === 'sensitive')
  const blockers = [...new Set(targets.flatMap((x) => x.blockedBy))]
  const [ack, setAck] = useState(false)
  const [closeBlocking, setCloseBlocking] = useState(true)
  const total = targets.reduce((s, x) => s + x.sizeBytes, 0)
  const label = (x: CleanerTarget) => `${t(`cleaner.items.${x.kind}.title`)}${x.browser ? ` · ${x.browser}` : ''}`

  return (
    <Modal
      title={t('cleaner.confirm.title')}
      icon="broom"
      wide
      onClose={onCancel}
      footer={
        <>
          <span className="modal__summary">{t('cleaner.confirm.summary', { count: targets.length, size: formatBytes(total, lng) })}</span>
          <button className="btn btn--ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className={`btn ${sensitive.length ? 'btn--danger' : 'btn--primary'}`} disabled={sensitive.length > 0 && !ack} onClick={() => onConfirm(closeBlocking, ack)}>
            <Icon name="broom" size={16} /> {t('cleaner.confirm.action')}
          </button>
        </>
      }
    >
      <p>{t('cleaner.confirm.body')}</p>
      <ul className="confirm-clean-list">
        {targets.map((x) => (
          <li key={x.id} className={`confirm-clean-list__item confirm-clean-list__item--${x.risk}`}>
            <div>
              <strong>{label(x)}</strong> <RiskTag risk={x.risk} />
              <p>{t(`cleaner.items.${x.kind}.effect`)}</p>
            </div>
            <span>{x.measurable ? formatBytes(x.sizeBytes, lng) : '—'}</span>
          </li>
        ))}
      </ul>

      {sensitive.length > 0 && (
        <div className="callout callout--critical clean-ack">
          <Icon name="warning" size={16} />
          <div>
            <strong>{t('cleaner.confirm.sensitiveTitle')}</strong>
            <ul>
              {sensitive.map((x) => (
                <li key={x.id}>{label(x)}</li>
              ))}
            </ul>
            <label className="checkbox">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              {t('cleaner.confirm.sensitiveAck')}
            </label>
          </div>
        </div>
      )}

      {blockers.length > 0 && (
        <label className="checkbox callout callout--caution">
          <input type="checkbox" checked={closeBlocking} onChange={(e) => setCloseBlocking(e.target.checked)} />
          <span>
            {t('cleaner.confirm.closeBlocking', { names: blockers.join(', ') })}
            <br />
            <small>{t('cleaner.confirm.closeBlockingHint')}</small>
          </span>
        </label>
      )}
    </Modal>
  )
}
