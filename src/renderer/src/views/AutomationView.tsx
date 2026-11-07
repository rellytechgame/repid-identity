import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AutomationConfig, AutomationState, SystemSnapshot } from '@shared/types'
import { isGamePath, normalizeAppName } from '@shared/engine/automation'
import { api } from '../api'
import { Icon, type IconName } from '../components/Icon'
import type { Toast } from '../components/ui'

interface Props {
  snapshot: SystemSnapshot | null
  notify: (toast: Omit<Toast, 'id'>) => void
}

export function AutomationView({ snapshot, notify }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [state, setState] = useState<AutomationState | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState('')

  const load = useCallback(async () => {
    try {
      setState(await api.automationGet())
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    }
  }, [notify, t])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 15000)
    return () => window.clearInterval(id)
  }, [load])

  const save = async (patch: (c: AutomationConfig) => AutomationConfig) => {
    if (!state) return
    setSaving(true)
    try {
      setState(await api.automationSet(patch(structuredClone(state.config))))
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const games = useMemo(() => (snapshot?.groups ?? []).filter((g) => isGamePath(g.path)), [snapshot])
  const runningApps = useMemo(() => {
    const names = new Map<string, string>()
    for (const g of snapshot?.groups ?? []) {
      if (g.risk !== 'safe') continue
      const key = normalizeAppName(g.name)
      if (!names.has(key)) names.set(key, g.identity.product ?? g.name)
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [snapshot])

  if (!state) return <div className="loading"><span className="spinner" /></div>
  const c = state.config

  return (
    <div className="startup automation">
      <section className={`clean-hero ${state.autoBoosting ? 'clean-hero--active' : ''}`}>
        <span className="clean-hero__icon"><Icon name="clock" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('automation.title')}</h2>
          <p>{state.autoBoosting ? t('automation.boostingNow', { name: state.autoBoosting }) : t('automation.intro')}</p>
        </div>
      </section>

      {!c.background.keepInTray && <p className="callout callout--info"><Icon name="info" size={16} /> {t('automation.onlyWhileOpen')}</p>}

      <div className="auto-grid">
        <Card icon="rocket" title={t('automation.boost.title')} body={t('automation.boost.body')} control={<Toggle disabled={saving} checked={c.autoBoost.enabled} label={t('automation.boost.title')} onChange={(v) => void save((x) => ({ ...x, autoBoost: { ...x.autoBoost, enabled: v } }))} />}>
          <label className="checkbox">
            <input type="checkbox" checked={c.autoBoost.games} disabled={saving} onChange={(e) => void save((x) => ({ ...x, autoBoost: { ...x.autoBoost, games: e.target.checked } }))} />
            {t('automation.boost.games')}
          </label>
          {games.length > 0 && <small className="muted">{t('automation.boost.gamesNow', { names: games.map((g) => g.identity.product ?? g.name).join(', ') })}</small>}
          <div className="chips">
            {c.autoBoost.apps.map((a) => (
              <span key={a} className="chip">
                {a}
                <button className="chip__x" aria-label={t('common.remove')} disabled={saving} onClick={() => void save((x) => ({ ...x, autoBoost: { ...x.autoBoost, apps: x.autoBoost.apps.filter((y) => y !== a) } }))}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="inline-form">
            <select className="select" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t('automation.boost.pick')}>
              <option value="">{t('automation.boost.pick')}</option>
              {runningApps.filter(([k]) => !c.autoBoost.apps.includes(k)).map(([k, label]) => (
                <option key={k} value={k}>{label} ({k})</option>
              ))}
            </select>
            <button
              className="btn btn--secondary btn--sm"
              disabled={!adding || saving}
              onClick={() => {
                const name = adding
                setAdding('')
                void save((x) => ({ ...x, autoBoost: { ...x.autoBoost, apps: [...x.autoBoost.apps, name] } }))
              }}
            >
              {t('common.add')}
            </button>
          </div>
        </Card>

        <Card icon="broom" title={t('automation.clean.title')} body={t('automation.clean.body')} control={<Toggle disabled={saving} checked={c.scheduledClean.enabled} label={t('automation.clean.title')} onChange={(v) => void save((x) => ({ ...x, scheduledClean: { ...x.scheduledClean, enabled: v } }))} />}>
          <div className="segmented" role="radiogroup">
            {(['daily', 'weekly'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={c.scheduledClean.frequency === f} className={c.scheduledClean.frequency === f ? 'is-active' : ''} disabled={saving} onClick={() => void save((x) => ({ ...x, scheduledClean: { ...x.scheduledClean, frequency: f } }))}>
                {t(`automation.clean.${f}`)}
              </button>
            ))}
          </div>
          {c.scheduledClean.enabled && state.nextCleanAt && (
            <small className="muted">
              {t('automation.clean.next', { date: new Date(Math.max(state.nextCleanAt, Date.now())).toLocaleString(lng, { dateStyle: 'medium', timeStyle: 'short' }) })}
            </small>
          )}
          {c.scheduledClean.lastRun && <small className="muted">{t('automation.clean.last', { date: new Date(c.scheduledClean.lastRun).toLocaleString(lng, { dateStyle: 'medium', timeStyle: 'short' }) })}</small>}
        </Card>

        <Card icon="bell" title={t('automation.alerts.title')} body={t('automation.alerts.body')}>
          <div className="auto-row">
            <span>{t('automation.alerts.memory')}</span>
            <Toggle disabled={saving} checked={c.alerts.memoryGrowth} label={t('automation.alerts.memory')} onChange={(v) => void save((x) => ({ ...x, alerts: { ...x.alerts, memoryGrowth: v } }))} />
          </div>
          <div className="auto-row">
            <span>{t('automation.alerts.disk', { pct: c.alerts.diskThreshold })}</span>
            <Toggle disabled={saving} checked={c.alerts.diskLow} label={t('automation.alerts.disk', { pct: c.alerts.diskThreshold })} onChange={(v) => void save((x) => ({ ...x, alerts: { ...x.alerts, diskLow: v } }))} />
          </div>
          <input
            type="range"
            min={70}
            max={98}
            step={1}
            value={c.alerts.diskThreshold}
            disabled={saving || !c.alerts.diskLow}
            aria-label={t('automation.alerts.threshold')}
            onChange={(e) => setState({ ...state, config: { ...c, alerts: { ...c.alerts, diskThreshold: Number(e.target.value) } } })}
            onMouseUp={(e) => void save((x) => ({ ...x, alerts: { ...x.alerts, diskThreshold: Number((e.target as HTMLInputElement).value) } }))}
            onKeyUp={(e) => void save((x) => ({ ...x, alerts: { ...x.alerts, diskThreshold: Number((e.target as HTMLInputElement).value) } }))}
          />
        </Card>

        <Card icon="power" title={t('automation.background.title')} body={t('automation.background.body')}>
          <div className="auto-row">
            <span>{t('automation.background.tray')}</span>
            <Toggle disabled={saving} checked={c.background.keepInTray} label={t('automation.background.tray')} onChange={(v) => void save((x) => ({ ...x, background: { ...x.background, keepInTray: v, launchAtLogin: v ? x.background.launchAtLogin : false } }))} />
          </div>
          {state.loginItemSupported && (
            <div className="auto-row">
              <span>{t('automation.background.login')}</span>
              <Toggle disabled={saving} checked={c.background.launchAtLogin} label={t('automation.background.login')} onChange={(v) => void save((x) => ({ ...x, background: { ...x.background, launchAtLogin: v, keepInTray: v || x.background.keepInTray } }))} />
            </div>
          )}
        </Card>
      </div>

      <section className="panel">
        <header className="panel__header">
          <h2><Icon name="list" size={16} /> {t('automation.log.title')}</h2>
        </header>
        {!state.events.length && <p className="empty">{t('automation.log.empty')}</p>}
        <ul className="event-list">
          {state.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <time className="muted">{new Date(e.at).toLocaleString(lng, { dateStyle: 'short', timeStyle: 'short' })}</time>
              <span>{t(`automation.log.${e.kind}`, e.params)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Card({ icon, title, body, control, children }: { icon: IconName; title: string; body: string; control?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="auto-card">
      <header>
        <span className="auto-card__icon"><Icon name={icon} size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p className="muted">{body}</p>
        </div>
        {control}
      </header>
      {children && <div className="auto-card__body">{children}</div>}
    </section>
  )
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled: boolean }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
    </label>
  )
}
