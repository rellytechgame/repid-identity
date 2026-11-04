import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppGroup, KillResult } from '@shared/types'
import { suggestTargets } from '@shared/engine/smart'
import { api, isDemo } from './api'
import { formatBytes, formatPercent } from './format'
import { usePrefersDark, useSettings, useSnapshot } from './hooks'
import { applyDocumentLanguage, resolveLanguage } from './i18n'
import { Icon, type IconName } from './components/Icon'
import { LogoMark, Wordmark } from './components/Logo'
import { StarButton, Toasts, type Toast } from './components/ui'
import { About } from './views/About'
import { Dashboard } from './views/Dashboard'
import { DetailPanel } from './views/DetailPanel'
import { ConfirmKill, SmartFree, type KillOptions } from './views/Dialogs'
import { Processes } from './views/Processes'
import { SettingsView } from './views/SettingsView'

type View = 'dashboard' | 'processes' | 'settings' | 'about'

const NAV: Array<{ id: View; icon: IconName }> = [
  { id: 'dashboard', icon: 'dashboard' },
  { id: 'processes', icon: 'list' },
  { id: 'settings', icon: 'settings' },
  { id: 'about', icon: 'info' }
]

export function App() {
  const { t, i18n } = useTranslation()
  const { settings, update } = useSettings()
  const { snapshot, history, error, refresh } = useSnapshot(settings.refreshMs)
  const prefersDark = usePrefersDark()
  const [view, setView] = useState<View>('dashboard')
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
    void api.setSettings({ protectedNames: settings.protectedNames })
  }, [settings.protectedNames])

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
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'is-active' : ''}`}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{t(`nav.${item.id}`)}</span>
              {item.id === 'processes' && snapshot && <span className="nav-item__count">{snapshot.groups.length}</span>}
            </button>
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

        <div className={`content ${selected && (view === 'dashboard' || view === 'processes') ? 'has-detail' : ''}`}>
          <main className="view">
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
              />
            )}
            {view === 'settings' && <SettingsView settings={settings} update={update} snapshot={snapshot} />}
            {view === 'about' && <About />}
          </main>
          {selected && (view === 'dashboard' || view === 'processes') && (
            <DetailPanel group={selected} onClose={() => setSelectedId(null)} onKill={requestKill} onStopService={stopService} />
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
