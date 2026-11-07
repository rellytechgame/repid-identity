import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServiceChangeOutcome, ServiceEntry, ServicesReport } from '@shared/types'
import { api, isDemo } from '../api'
import { readSetting } from '../hooks'
import { Icon } from '../components/Icon'
import { AppAvatar, Modal, type Toast } from '../components/ui'
import { announceRestorePoint } from './HealthView'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

export function ServicesView({ notify }: Props) {
  const { t } = useTranslation()
  const [report, setReport] = useState<ServicesReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ServiceEntry[] | null>(null)

  const scan = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await api.servicesScan())
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [notify, t])

  useEffect(() => {
    void scan()
  }, [scan])

  const announce = (out: ServiceChangeOutcome[], restore: boolean) => {
    const changed = out.filter((o) => o.status === 'changed').length
    const admin = out.filter((o) => o.status === 'needs-admin').length
    const failed = out.length - changed - admin
    notify({
      tone: changed && !failed && !admin ? 'success' : changed ? 'warning' : 'error',
      title: changed ? t(restore ? 'services.toast.restored' : 'services.toast.manual', { count: changed }) : t('startup.toast.nothing'),
      body: [admin ? t('services.toast.needsAdmin') : '', failed ? t('startup.toast.failed', { count: failed }) : '', changed && !restore ? t('services.nextBoot') : ''].filter(Boolean).join(' ') || undefined
    })
  }

  const change = async (list: ServiceEntry[], restore: boolean, allowCaution: boolean) => {
    setConfirm(null)
    setBusy(true)
    try {
      // A restore point first (Windows, admin): one click in Windows undoes everything if something misbehaves.
      if (!restore && readSetting('restorePoints') && !isDemo) announceRestorePoint(await api.restorePoint('services'), notify, t, false)
      announce(await api.servicesSet({ names: list.map((s) => s.name), restore, allowCaution }), restore)
      await scan()
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const services = report?.services ?? []
  const recommended = services.filter((s) => s.recommended)
  const byRepid = services.filter((s) => s.changedByRepid)
  const canChange = !!report?.elevated || isDemo

  return (
    <div className="startup services">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="server" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('services.title')}</h2>
          <p>{loading && !report ? t('services.scanning') : t('services.summary', { count: services.filter((s) => !s.changedByRepid).length, rec: recommended.length })}</p>
        </div>
        <button className="btn btn--secondary" onClick={() => void scan()} disabled={loading || busy}>
          <Icon name="refresh" size={16} /> {t('startup.rescan')}
        </button>
        <button className="btn btn--primary btn--lg" disabled={!recommended.length || busy || !canChange} onClick={() => setConfirm(recommended)}>
          <Icon name="server" size={16} /> {t('services.applySuggested', { count: recommended.length })}
        </button>
      </section>

      <p className="callout callout--info"><Icon name="shield" size={16} /> {t('services.safeNote')}</p>
      {report && !report.supported && <p className="callout callout--caution">{t('services.unsupported')}</p>}
      {report?.supported && !canChange && (
        <div className="callout callout--caution clean-elevate">
          <Icon name="lock" size={16} />
          <span>{t('services.needsAdmin')}</span>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.relaunchElevated()}>{t('settings.relaunchAdmin')}</button>
        </div>
      )}
      {byRepid.length > 0 && (
        <div className="callout callout--info startup-history">
          <Icon name="undo" size={16} />
          <span><strong>{t('startup.history.title')}</strong> · {t('services.history', { count: byRepid.length })}</span>
          <button className="btn btn--secondary btn--sm" onClick={() => void change(byRepid, true, true)} disabled={busy || !canChange}>
            <Icon name="undo" size={14} /> {t('startup.history.restore')}
          </button>
        </div>
      )}

      {report?.supported && (
        <section className="panel">
          {!services.length && <p className="empty">{t('services.empty')}</p>}
          <ul className="startup-list">
            {services.map((s) => {
              const auto = s.startMode === 'auto' || s.startMode === 'delayed'
              return (
                <li key={s.name} className={`startup-row ${auto ? '' : 'is-off'}`}>
                  <AppAvatar name={s.displayName} size={36} />
                  <div className="startup-row__text">
                    <div className="startup-row__title">
                      <strong>{s.displayName}</strong>
                      {s.recommended && <span className="badge badge--suggested"><Icon name="sparkles" size={12} /> {t('startup.suggested')}</span>}
                      {s.risk === 'caution' && <span className="badge badge--caution"><Icon name="warning" size={12} /> {t('risk.caution')}</span>}
                      {s.changedByRepid && <span className="badge badge--repid">{t('startup.changedByRepid')}</span>}
                    </div>
                    <p className="startup-row__meta">
                      {[s.vendor, s.name, t(`services.mode.${s.startMode}`), s.running ? t('services.running') : t('services.stopped')].filter(Boolean).join(' · ')}
                    </p>
                    <p className="clean-row__effect">
                      <span className="clean-row__what">{t('services.whatHappens')}</span> {t(`services.catalog.${s.catalogKey ?? 'thirdParty'}`)}
                    </p>
                  </div>
                  <div className="startup-row__side">
                    <span className={`impact-pill ${auto ? 'impact-pill--medium' : 'impact-pill--off'}`}>{t(`services.mode.${s.startMode}`)}</span>
                    {s.changedByRepid ? (
                      <button className="btn btn--secondary btn--sm" disabled={busy || !canChange} onClick={() => void change([s], true, true)}>
                        <Icon name="undo" size={14} /> {t('services.undo')}
                      </button>
                    ) : (
                      <button className="btn btn--secondary btn--sm" disabled={busy || !canChange || !auto} onClick={() => (s.risk === 'caution' ? setConfirm([s]) : void change([s], false, false))}>
                        {t('services.toManual')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {confirm && <ConfirmServices list={confirm} onCancel={() => setConfirm(null)} onConfirm={(ack) => void change(confirm, false, ack)} />}
    </div>
  )
}

function ConfirmServices({ list, onCancel, onConfirm }: { list: ServiceEntry[]; onCancel: () => void; onConfirm: (ack: boolean) => void }) {
  const { t } = useTranslation()
  const caution = list.filter((s) => s.risk === 'caution')
  const [ack, setAck] = useState(false)
  return (
    <Modal
      title={t('services.confirm.title')}
      icon="server"
      wide
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className={`btn ${caution.length ? 'btn--danger' : 'btn--primary'}`} disabled={caution.length > 0 && !ack} onClick={() => onConfirm(ack)}>
            {t('services.confirm.action', { count: list.length })}
          </button>
        </>
      }
    >
      <p>{t('services.confirm.body')}</p>
      <ul className="confirm-clean-list">
        {list.map((s) => (
          <li key={s.name} className={`confirm-clean-list__item confirm-clean-list__item--${s.risk === 'caution' ? 'caution' : 'safe'}`}>
            <div>
              <strong>{s.displayName}</strong>
              <p>{t(`services.catalog.${s.catalogKey ?? 'thirdParty'}`)}</p>
            </div>
          </li>
        ))}
      </ul>
      {caution.length > 0 && (
        <label className="checkbox clean-ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {t('services.confirm.ack')}
        </label>
      )}
      <p className="muted">{t('services.nextBoot')}</p>
    </Modal>
  )
}
