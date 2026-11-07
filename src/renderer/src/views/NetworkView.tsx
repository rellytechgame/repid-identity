import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NetworkApp, NetworkBlockResult, NetworkReport } from '@shared/types'
import { api, isDemo } from '../api'
import { formatBytes } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, Modal, type Toast } from '../components/ui'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

export function NetworkView({ notify }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [report, setReport] = useState<NetworkReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<NetworkApp | null>(null)
  const loading = useRef(false)

  const scan = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      setReport(await api.networkScan())
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      loading.current = false
    }
  }, [notify, t])

  useEffect(() => {
    void scan()
    const id = window.setInterval(() => {
      if (!document.hidden) void scan()
    }, 4000)
    return () => window.clearInterval(id)
  }, [scan])

  const announce = (res: NetworkBlockResult, name: string) => {
    const tone = res.status === 'blocked' || res.status === 'unblocked' ? 'success' : 'error'
    notify({ tone, title: t(`network.status.${res.status}`, { name }), body: res.error })
  }

  const setBlocked = async (target: { groupId?: string; ruleId?: string }, block: boolean, name: string) => {
    setConfirm(null)
    setBusy(target.groupId ?? target.ruleId ?? '')
    try {
      announce(await api.networkBlock({ ...target, block }), name)
      await scan()
    } finally {
      setBusy(null)
    }
  }

  const rate = (b: number) => `${formatBytes(b, lng)}/s`
  const isWin = window.repid?.platform === 'win32' || isDemo

  return (
    <div className="startup network">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="wifi" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('network.title')}</h2>
          <p>{report ? t('network.summary', { count: report.apps.filter((a) => a.connections > 0).length }) : t('network.scanning')}</p>
        </div>
        {report && (
          <div className="net-rates">
            <span title={t('network.download')}>↓ {rate(report.rxBytesPerSec)}</span>
            <span title={t('network.upload')}>↑ {rate(report.txBytesPerSec)}</span>
          </div>
        )}
      </section>

      <p className="callout callout--info"><Icon name="info" size={16} /> {t('network.note')}</p>
      {report && isWin && !report.elevated && !isDemo && (
        <div className="callout callout--caution clean-elevate">
          <Icon name="lock" size={16} />
          <span>{t('network.needsAdmin')}</span>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.relaunchElevated()}>{t('settings.relaunchAdmin')}</button>
        </div>
      )}

      {report && report.blockedIdle.length > 0 && (
        <section className="panel">
          <header className="panel__header"><h2><Icon name="lock" size={16} /> {t('network.blockedIdle')}</h2></header>
          <ul className="leftover-list net-blocked">
            {report.blockedIdle.map((r) => (
              <li key={r.id}>
                <label>
                  <Icon name="lock" size={14} />
                  <span className="leftover-list__text"><span className="mono break">{r.path}</span></span>
                  <button className="btn btn--secondary btn--sm" disabled={busy === r.id} onClick={(e) => { e.preventDefault(); void setBlocked({ ruleId: r.id }, false, r.path) }}>
                    {t('network.unblock')}
                  </button>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <section className="panel">
          <header className="panel__header"><h2><Icon name="globe" size={16} /> {t('network.apps')}</h2></header>
          {!report.apps.length && <p className="empty">{t('network.empty')}</p>}
          <ul className="startup-list">
            {report.apps.map((a) => {
              const name = a.product ?? a.name
              return (
                <li key={a.groupId} className={`startup-row ${a.blocked ? 'is-off' : ''}`}>
                  <AppAvatar name={name} size={36} />
                  <div className="startup-row__text">
                    <div className="startup-row__title">
                      <strong>{name}</strong>
                      {a.blocked && <span className="badge badge--critical"><Icon name="lock" size={12} /> {t('network.blockedBadge')}</span>}
                      {a.risk === 'critical' && <span className="badge badge--critical" title={t('startup.lockedHint')}><Icon name="shield" size={12} /> {t('startup.locked')}</span>}
                    </div>
                    <p className="startup-row__meta">
                      {t('network.connections', { count: a.connections })}
                      {a.listening.length > 0 && <> · {t('network.listening', { ports: a.listening.join(', ') })}</>}
                    </p>
                    {a.remotes.length > 0 && <p className="startup-row__cmd mono" title={a.remotes.join('\n')}>{a.remotes.join('  ·  ')}</p>}
                  </div>
                  <div className="startup-row__side">
                    {report.blockSupported && a.blockable && (
                      <button
                        className={`btn btn--sm ${a.blocked ? 'btn--secondary' : 'btn--danger-ghost'}`}
                        disabled={busy === a.groupId || !report.elevated}
                        onClick={() => (a.blocked ? void setBlocked({ groupId: a.groupId }, false, name) : setConfirm(a))}
                      >
                        <Icon name={a.blocked ? 'undo' : 'lock'} size={14} /> {a.blocked ? t('network.unblock') : t('network.block')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {confirm && (
        <Modal
          title={t('network.confirm.title', { name: confirm.product ?? confirm.name })}
          icon="lock"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
              <button className="btn btn--danger" onClick={() => void setBlocked({ groupId: confirm.groupId }, true, confirm.product ?? confirm.name)}>
                <Icon name="lock" size={16} /> {t('network.block')}
              </button>
            </>
          }
        >
          <p>{t('network.confirm.body')}</p>
          <p className="muted">{t('network.confirm.undo')}</p>
        </Modal>
      )}
    </div>
  )
}
