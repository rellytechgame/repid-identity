import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppGroup, ProcessDetails } from '@shared/types'
import { api } from '../api'
import { describeIdentity, formatBytes, formatPercent } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, CategoryBadge, ImpactBar, RiskBadge } from '../components/ui'

interface Props {
  group: AppGroup
  onClose: () => void
  onKill: (groups: AppGroup[]) => void
  onStopService: (group: AppGroup) => void
}

export function DetailPanel({ group, onClose, onKill, onStopService }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [details, setDetails] = useState<ProcessDetails | null>(null)
  const [showCmd, setShowCmd] = useState(false)

  useEffect(() => {
    let alive = true
    setDetails(null)
    api
      .details(group.rootPid)
      .then((d) => alive && setDetails(d))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [group.rootPid])

  const critical = group.risk === 'critical'

  return (
    <aside className="detail" aria-label={t('detail.title')}>
      <header className="detail__header">
        <AppAvatar name={group.name} size={44} />
        <div className="detail__title">
          <h2>{group.identity.product ?? group.name}</h2>
          <div className="detail__badges">
            <CategoryBadge category={group.identity.category} />
            <RiskBadge risk={group.risk} />
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </header>

      <div className="detail__scroll">
        <section className="detail__section detail__what">
          <h3>{t('detail.whatItDoes')}</h3>
          <p>{describeIdentity(group.identity, t)}</p>
          {details?.description && (
            <p className="muted">
              {t('detail.fileDescription')}: <strong>{details.description}</strong>
              {details.company && <> · {details.company}</>}
              {details.version && <> · v{details.version}</>}
            </p>
          )}
          {critical && (
            <p className="callout callout--critical">
              <Icon name="lock" size={16} /> {t('risk.criticalHint')}
            </p>
          )}
          {group.risk === 'caution' && (
            <p className="callout callout--caution">
              <Icon name="warning" size={16} /> {t('risk.cautionHint')}
            </p>
          )}
        </section>

        <section className="detail__section">
          <h3>{t('detail.resources')}</h3>
          <dl className="kv-grid">
            <div><dt>CPU</dt><dd>{formatPercent(group.cpu, lng)}</dd></div>
            <div><dt>RAM</dt><dd>{formatBytes(group.memBytes, lng)}</dd></div>
            <div><dt>GPU</dt><dd>{group.gpu > 0 ? formatPercent(group.gpu, lng) : '—'}</dd></div>
            <div><dt>{t('detail.processes')}</dt><dd>{group.pids.length + group.descendantPids.length}</dd></div>
          </dl>
          <div className="detail__impact">
            <span>{t('processes.colImpact')}</span>
            <ImpactBar value={group.impact} />
            <strong>{group.impact}/100</strong>
          </div>
        </section>

        {group.services.length > 0 && (
          <section className="detail__section">
            <h3>{t('detail.services')}</h3>
            <p className="muted">{t('detail.servicesHint')}</p>
            <ul className="chips">
              {group.services.map((s) => (
                <li key={s.name} className="chip">{s.name}</li>
              ))}
            </ul>
            <button className="btn btn--secondary" onClick={() => onStopService(group)} disabled={critical}>
              <Icon name="stop" size={14} /> {t('actions.stopService')}
            </button>
          </section>
        )}

        <section className="detail__section">
          <h3>{t('detail.identity')}</h3>
          <dl className="kv-list">
            <div><dt>{t('detail.executable')}</dt><dd className="mono">{group.name}</dd></div>
            {group.path && <div><dt>{t('detail.path')}</dt><dd className="mono break">{group.path}</dd></div>}
            {group.user && <div><dt>{t('detail.user')}</dt><dd>{group.user}</dd></div>}
            <div><dt>PID</dt><dd className="mono">{group.pids.slice(0, 12).join(', ')}{group.pids.length > 12 ? '…' : ''}</dd></div>
            {group.command && (
              <div>
                <dt>{t('detail.command')}</dt>
                <dd className={`mono break ${showCmd ? '' : 'clamp-2'}`} onClick={() => setShowCmd((v) => !v)} title={t('detail.expand')}>
                  {group.command}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="detail__section">
          <h3><Icon name="tree" size={16} /> {t('detail.tree')}</h3>
          {!details && <p className="muted">{t('common.loading')}</p>}
          {details && (
            <ul className="tree">
              {details.tree.slice(0, 80).map((n) => (
                <li key={n.pid} style={{ paddingInlineStart: `${Math.min(n.depth, 8) * 14}px` }}>
                  <span className="tree__name">{n.depth > 0 && <span className="tree__elbow">└</span>}{n.name}</span>
                  <span className="tree__pid mono">{n.pid}</span>
                  <span className="tree__mem">{formatBytes(n.memBytes, lng)}</span>
                </li>
              ))}
              {details.tree.length > 80 && <li className="muted">+{details.tree.length - 80}</li>}
            </ul>
          )}
        </section>
      </div>

      <footer className="detail__footer">
        <button className="btn btn--danger btn--block" disabled={critical} onClick={() => onKill([group])}>
          <Icon name="tree" /> {t('actions.endTreeCount', { count: group.pids.length + group.descendantPids.length })}
        </button>
      </footer>
    </aside>
  )
}
