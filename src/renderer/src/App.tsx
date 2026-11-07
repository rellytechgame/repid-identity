import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppGroup, BoostProfileId, CleanResult, KillResult } from '@shared/types'
import { suggestTargets } from '@shared/engine/smart'
import { api, isDemo } from './api'
import { formatBytes, formatPercent } from './format'
import { useAppUpdate, useBoost, usePrefersDark, useSettings, useSnapshot } from './hooks'
import { applyDocumentLanguage, resolveLanguage } from './i18n'
import { Icon, type IconName } from './components/Icon'
import { LogoMark, Wordmark } from './components/Logo'
import { StarButton, Toasts, type Toast } from './components/ui'
import { About } from './views/About'
import { AutomationView } from './views/AutomationView'
import { DiskView } from './views/DiskView'
import { HealthView } from './views/HealthView'
import { NetworkView } from './views/NetworkView'
import { ServicesView } from './views/ServicesView'
import { UpdatesView } from './views/UpdatesView'
import { BoostView } from './views/BoostView'
import { Dashboard } from './views/Dashboard'
import { DetailPanel } from './views/DetailPanel'
import { ConfirmKill, SmartFree, type KillOptions } from './views/Dialogs'
import { CleanerView } from './views/CleanerView'
import { Processes } from './views/Processes'
import { SettingsView } from './views/SettingsView'
import { StartupView } from './views/StartupView'
import { UninstallView } from './views/UninstallView'

type View =
  | 'dashboard'
  | 'processes'
  | 'network'
  | 'health'
  | 'boost'
  | 'automation'
  | 'startup'
  | 'services'
  | 'cleaner'
  | 'disk'
  | 'uninstall'
  | 'updates'
  | 'settings'
  | 'about'

/** Grouped by what the user wants to do: look, speed up, free space, configure. */
const NAV: Array<{ section: string; items: Array<{ id: View; icon: IconName }> }> = [
  {
    section: 'monitor',
    items: [
      { id: 'dashboard', icon: 'dashboard' },
      { id: 'processes', icon: 'list' },
      { id: 'network', icon: 'wifi' },
      { id: 'health', icon: 'pulse' }
    ]
  },
  {
    section: 'optimize',
    items: [
      { id: 'boost', icon: 'rocket' },
      { id: 'automation', icon: 'clock' },
      { id: 'startup', icon: 'power' },
      { id: 'services', icon: 'server' }
    ]
  },
  {
    section: 'clean',
    items: [
      { id: 'cleaner', icon: 'broom' },
      { id: 'disk', icon: 'disk' },
      { id: 'uninstall', icon: 'package' },
      { id: 'updates', icon: 'download' }
    ]
  },
  {
    section: 'app',
    items: [
      { id: 'settings', icon: 'settings' },
      { id: 'about', icon: 'info' }
    ]
  }
]
const VIEWS = new Set<string>(NAV.flatMap((s) => s.items.map((i) => i.id)))

export function App() {
  const { t, i18n } = useTranslation()
  const { settings, update } = useSettings()
  const { snapshot, history, error, refresh } = useSnapshot(settings.refreshMs)
  const { boost, setBoost } = useBoost(snapshot?.timestamp)
  const prefersDark = usePrefersDark()
  const { info: appUpdate, check: checkUpdate } = useAppUpdate(settings.checkUpdates && !isDemo)
  const showUpdate = !!appUpdate?.available && appUpdate.latest !== settings.dismissedUpdate
  const [view, setView] = useState<View>('dashboard')
  const viewRef = useRef<HTMLElement>(null)
  // Every section shares one scroll container: start each one at the top.
  useEffect(() => {
    viewRef.current?.scrollTo({ top: 0 })
  }, [view])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmGroups, setConfirmGroups] = useState<AppGroup[] | null>(null)
  const [smartOpen, setSmartOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const theme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    void api.setTitleBarTheme(theme)
  }, [theme])

  useEffect(() => {
    const lng = resolveLanguage(settings.language)
    void i18n.changeLanguage(lng)
    applyDocumentLanguage(lng)
  }, [settings.language, i18n])

  useEffect(() => {
    void api.setSettings({ protectedNames: settings.protectedNames, language: i18n.language })
  }, [settings.protectedNames, i18n.language])

  // A clicked system notification (automation alerts) opens its section.
  useEffect(() => api.onNavigate((v) => VIEWS.has(v) && setView(v as View)), [])

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-3), { ...toast, id }])
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 7000)
  }, [])

  const selected = useMemo(
    () => snapshot?.groups.find((g) => g.id === selectedId) ?? null,
    [snapshot, selectedId]
  )

  const reportKill = (result: KillResult) => {
    const lng = i18n.language
    const count = (s: string) => result.outcomes.filter((o) => o.status === s).length
    const killed = count('killed')
    const denied = count('denied') + count('failed')
    const protectedCount = count('protected')
    const extra = [
      denied ? t('toast.denied', { count: denied }) : '',
      protectedCount ? t('toast.protectedSkipped', { count: protectedCount }) : ''
    ].filter(Boolean)
    pushToast({
      tone: killed && !denied ? 'success' : killed ? 'warning' : 'error',
      title: killed
        ? t('toast.freed', { count: killed, mem: formatBytes(result.freedMemBytes, lng), cpu: formatPercent(result.freedCpu, lng) })
        : t('toast.nothingEnded'),
      body: extra.join(' ') || undefined
    })
  }

  const reportClean = (result: CleanResult) => {
    const count = (s: string) => result.outcomes.filter((o) => o.status === s).length
    const notes = [
      count('skipped-running') ? t('cleaner.toast.skippedRunning', { count: count('skipped-running') }) : '',
      count('needs-admin') ? t('cleaner.toast.needsAdmin', { count: count('needs-admin') }) : '',
      count('partial') ? t('cleaner.toast.partial', { count: count('partial') }) : '',
      count('failed') ? t('cleaner.toast.failed', { count: count('failed') }) : ''
    ].filter(Boolean)
    pushToast({
      tone: notes.length ? 'warning' : 'success',
      title: t('cleaner.toast.done', { size: formatBytes(result.freedBytes, i18n.language) }),
      body: notes.join(' ') || undefined
    })
  }

  const performKill = async (groups: AppGroup[], opts: KillOptions) => {
    setConfirmGroups(null)
    setSmartOpen(false)
    setBusy(true)
    try {
      const result = await api.kill({ pids: groups.flatMap((g) => g.pids), ...opts })
      reportKill(result)
      if (groups.some((g) => g.id === selectedId)) setSelectedId(null)
    } catch (err) {
      pushToast({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const requestKill = (groups: AppGroup[]) => {
    const targets = groups.filter((g) => g.risk !== 'critical')
    if (!targets.length) return
    if (settings.confirmKill || targets.some((g) => g.risk === 'caution')) setConfirmGroups(targets)
    else void performKill(targets, { force: false, allowCaution: false })
  }

  const stopService = async (group: AppGroup) => {
    setBusy(true)
    try {
      const res = await api.stopService(group.rootPid)
      if (res.ok) pushToast({ tone: 'success', title: t('toast.serviceStopped', { name: res.service }) })
      else
        pushToast({
          tone: 'error',
          title: t('toast.serviceFailed', { name: res.service || group.name }),
          body: res.needsElevation ? t('toast.needsAdmin') : res.error === 'shared-host' ? t('toast.sharedHost') : res.error
        })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const boosted = useMemo(() => new Map(boost.apps.flatMap((a) => a.groupIds.map((id) => [id, a.role] as const))), [boost])

  const applyBoost = async (profile: BoostProfileId, focusGroupId: string | undefined, ecoGroupIds: string[], toast?: string) => {
    setBusy(true)
    try {
      const state = await api.boostApply({ profile, focusGroupId, ecoGroupIds })
      setBoost(state)
      pushToast(
        state.active
          ? { tone: 'success', title: toast ?? t('boost.toast.applied', { count: state.apps.length }) }
          : { tone: 'info', title: t('boost.toast.stopped') }
      )
    } catch (err) {
      pushToast({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const stopBoost = async (toast?: string) => {
    setBusy(true)
    try {
      setBoost(await api.boostStop())
      pushToast({ tone: 'success', title: toast ?? t('boost.toast.stopped') })
    } finally {
      setBusy(false)
    }
  }

  /** Detail-panel switch: rebuilds the current plan with this app added or removed. */
  const toggleEco = (group: AppGroup, on: boolean) => {
    const others = boost.apps.filter((a) => !a.groupIds.includes(group.id))
    const eco = others.filter((a) => a.role === 'eco').flatMap((a) => a.groupIds)
    const focus = others.find((a) => a.role === 'focus')?.groupIds[0]
    const name = group.identity.product ?? group.name
    if (on) eco.push(group.id)
    if (!eco.length && !focus) void stopBoost(t('boost.toast.ecoOff', { name }))
    else void applyBoost(boost.profile ?? 'custom', focus, eco, t(on ? 'boost.toast.ecoOn' : 'boost.toast.ecoOff', { name }))
  }

  const suggestions = snapshot ? suggestTargets(snapshot.groups, { threshold: settings.smartThreshold }) : []
  const platformClass = `platform-${window.repid?.platform ?? 'web'}`

  return (
    <div className={`app ${platformClass}`}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <LogoMark size={34} />
          <Wordmark />
        </div>
        <nav className="sidebar__nav" aria-label={t('nav.label')}>
          {NAV.map((group) => (
            <div key={group.section} className="nav-section">
              <span className="nav-section__label">{t(`nav.sections.${group.section}`)}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${view === item.id ? 'is-active' : ''}`}
                  onClick={() => setView(item.id)}
                  aria-current={view === item.id ? 'page' : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{t(`nav.${item.id}`)}</span>
                  {item.id === 'processes' && snapshot && <span className="nav-item__count">{snapshot.groups.length}</span>}
                  {item.id === 'boost' && boost.active && <span className="nav-item__dot" title={t('nav.boostActive')} />}
                  {item.id === 'about' && appUpdate?.available && <span className="nav-item__dot nav-item__dot--update" title={t('update.available', { version: appUpdate.latest })} />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button className="btn btn--primary btn--block" onClick={() => setSmartOpen(true)} disabled={!suggestions.length || busy}>
            <Icon name="bolt" size={16} /> {t('smart.cta')}
          </button>
          <p className="sidebar__credit">
            {t('about.by')} <strong>Voxel Enterprise</strong>
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{t(`nav.${view}`)}</h1>
          {isDemo && <span className="badge badge--demo" title={t('demo.hint')}>{t('demo.badge')}</span>}
          <span className={`live ${error ? 'live--error' : ''}`}>
            <span className="live__dot" />
            {error ? t('status.error') : busy ? t('status.working') : t('status.live', { seconds: settings.refreshMs / 1000 })}
          </span>
          <div className="topbar__spacer" />
          <div className="topbar__actions">
            <button className="icon-btn" onClick={() => void refresh()} aria-label={t('common.refresh')} title={t('common.refresh')}>
              <Icon name="refresh" />
            </button>
            <StarButton compact />
          </div>
        </header>

        {showUpdate && appUpdate && (
          <div className="update-banner" role="status">
            <Icon name="download" size={18} />
            <span>
              <strong>{t('update.available', { version: appUpdate.latest })}</strong> {t('update.current', { version: appUpdate.current })}
            </span>
            <button className="btn btn--primary btn--sm" onClick={() => void api.openRelease()}>
              <Icon name="external" size={14} /> {t('update.cta')}
            </button>
            <button className="icon-btn icon-btn--sm" aria-label={t('update.later')} title={t('update.later')} onClick={() => update({ dismissedUpdate: appUpdate.latest })}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        <div className={`content ${selected && (view === 'dashboard' || view === 'processes') ? 'has-detail' : ''}`}>
          <main className="view" ref={viewRef}>
            {!snapshot && !error && (
              <div className="loading">
                <LogoMark size={56} />
                <p>{t('status.scanning')}</p>
              </div>
            )}
            {!snapshot && error && <p className="callout callout--critical">{error}</p>}
            {snapshot && view === 'dashboard' && (
              <Dashboard
                snapshot={snapshot}
                history={history}
                threshold={settings.smartThreshold}
                onSelect={(g) => setSelectedId(g.id)}
                onKill={requestKill}
                onSmartFree={() => setSmartOpen(true)}
              />
            )}
            {snapshot && view === 'processes' && (
              <Processes
                snapshot={snapshot}
                selectedId={selectedId ?? undefined}
                showProtected={settings.showProtected}
                onToggleProtected={(v) => update({ showProtected: v })}
                onSelect={(g) => setSelectedId(g.id)}
                onKill={requestKill}
                boosted={boosted}
              />
            )}
            {snapshot && view === 'boost' && (
              <BoostView snapshot={snapshot} boost={boost} busy={busy} onApply={(p, f, e) => void applyBoost(p, f, e)} onStop={() => void stopBoost()} />
            )}
            {view === 'startup' && <StartupView notify={pushToast} />}
            {view === 'services' && <ServicesView notify={pushToast} />}
            {view === 'automation' && <AutomationView snapshot={snapshot} notify={pushToast} />}
            {view === 'network' && <NetworkView notify={pushToast} />}
            {view === 'health' && <HealthView notify={pushToast} />}
            {view === 'disk' && <DiskView notify={pushToast} />}
            {view === 'updates' && <UpdatesView notify={pushToast} />}
            {view === 'uninstall' && <UninstallView notify={pushToast} />}
            {view === 'cleaner' && <CleanerView onResult={(result) => reportClean(result)} />}
            {view === 'settings' && <SettingsView settings={settings} update={update} snapshot={snapshot} />}
            {view === 'about' && <About update={appUpdate} onCheck={() => checkUpdate(true)} />}
          </main>
          {selected && (view === 'dashboard' || view === 'processes') && (
            <DetailPanel
              group={selected}
              boostRole={boosted.get(selected.id)}
              busy={busy}
              onClose={() => setSelectedId(null)}
              onKill={requestKill}
              onStopService={stopService}
              onEco={(on) => toggleEco(selected, on)}
            />
          )}
        </div>
      </div>

      {confirmGroups && (
        <ConfirmKill
          groups={confirmGroups}
          platform={snapshot?.platform ?? 'web'}
          onCancel={() => setConfirmGroups(null)}
          onConfirm={(opts) => void performKill(confirmGroups, opts)}
        />
      )}
      {smartOpen && (
        <SmartFree
          suggestions={suggestions}
          onCancel={() => setSmartOpen(false)}
          onConfirm={(groups) => void performKill(groups, { force: false, allowCaution: false })}
        />
      )}
      <Toasts toasts={toasts} dismiss={(id) => setToasts((list) => list.filter((x) => x.id !== id))} />
    </div>
  )
}
