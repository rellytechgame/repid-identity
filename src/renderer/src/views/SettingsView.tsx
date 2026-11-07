import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SystemSnapshot } from '@shared/types'
import { api, isDemo } from '../api'
import type { Settings, Theme } from '../hooks'
import { LANGUAGES } from '../i18n'
import { Icon } from '../components/Icon'

const INTERVALS = [1000, 2000, 3000, 5000, 10000]

export function SettingsView({ settings, update, snapshot }: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  snapshot: SystemSnapshot | null
}) {
  const { t, i18n } = useTranslation()
  const [newName, setNewName] = useState('')

  const addProtected = () => {
    const name = newName.trim()
    if (name && !settings.protectedNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      update({ protectedNames: [...settings.protectedNames, name] })
    }
    setNewName('')
  }

  return (
    <div className="settings">
      <section className="panel">
        <header className="panel__header"><h2><Icon name="globe" size={18} /> {t('settings.general')}</h2></header>
        <div className="field">
          <div>
            <label htmlFor="lang">{t('settings.language')}</label>
            <p className="muted">
              {t('settings.languageHint')}{' '}
              <button className="link" onClick={() => void api.openRepo('translate')}>{t('settings.addLanguage')}</button>
            </p>
          </div>
          <select id="lang" value={i18n.language} onChange={(e) => update({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="theme">{t('settings.theme')}</label>
          <div className="segmented" role="radiogroup" id="theme">
            {(['system', 'dark', 'light'] as Theme[]).map((th) => (
              <button key={th} role="radio" aria-checked={settings.theme === th} className={settings.theme === th ? 'is-active' : ''} onClick={() => update({ theme: th })}>
                {t(`settings.themes.${th}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="interval">{t('settings.refresh')}</label>
          <select id="interval" value={settings.refreshMs} onChange={(e) => update({ refreshMs: Number(e.target.value) })}>
            {INTERVALS.map((ms) => (
              <option key={ms} value={ms}>{t('settings.seconds', { count: ms / 1000 })}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header"><h2><Icon name="shield" size={18} /> {t('settings.safety')}</h2></header>
        <div className="field">
          <div>
            <label htmlFor="confirm">{t('settings.confirmKill')}</label>
            <p className="muted">{t('settings.confirmKillHint')}</p>
          </div>
          <label className="switch">
            <input id="confirm" type="checkbox" checked={settings.confirmKill} onChange={(e) => update({ confirmKill: e.target.checked })} />
            <span className="switch__track" />
          </label>
        </div>
        {(window.repid?.platform ?? 'win32') === 'win32' && (
          <div className="field">
            <div>
              <label htmlFor="restore-points">{t('settings.restorePoints')}</label>
              <p className="muted">{t('settings.restorePointsHint')}</p>
            </div>
            <label className="switch">
              <input id="restore-points" type="checkbox" checked={settings.restorePoints} onChange={(e) => update({ restorePoints: e.target.checked })} />
              <span className="switch__track" />
            </label>
          </div>
        )}
        <div className="field">
          <div>
            <label htmlFor="check-updates">{t('settings.checkUpdates')}</label>
            <p className="muted">{t('settings.checkUpdatesHint')}</p>
          </div>
          <label className="switch">
            <input id="check-updates" type="checkbox" checked={settings.checkUpdates} onChange={(e) => update({ checkUpdates: e.target.checked })} />
            <span className="switch__track" />
          </label>
        </div>
        <div className="field">
          <div>
            <label htmlFor="threshold">{t('settings.threshold', { value: settings.smartThreshold })}</label>
            <p className="muted">{t('settings.thresholdHint')}</p>
          </div>
          <input id="threshold" type="range" min={10} max={80} step={5} value={settings.smartThreshold} onChange={(e) => update({ smartThreshold: Number(e.target.value) })} />
        </div>
        <div className="field field--stack">
          <div>
            <label htmlFor="protect">{t('settings.protected')}</label>
            <p className="muted">{t('settings.protectedHint')}</p>
          </div>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); addProtected() }}>
            <input id="protect" value={newName} maxLength={128} placeholder={t('settings.protectedPlaceholder')} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn btn--secondary" type="submit">{t('common.add')}</button>
          </form>
          <ul className="chips">
            {settings.protectedNames.map((n) => (
              <li key={n} className="chip">
                <Icon name="lock" size={12} /> {n}
                <button aria-label={t('common.remove')} onClick={() => update({ protectedNames: settings.protectedNames.filter((x) => x !== n) })}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {!isDemo && snapshot && (
        <section className="panel">
          <header className="panel__header"><h2><Icon name="lock" size={18} /> {t('settings.privileges')}</h2></header>
          <div className="field">
            <div>
              <label>{snapshot.elevated ? t('settings.elevatedYes') : t('settings.elevatedNo')}</label>
              <p className="muted">{t(`settings.elevationHint.${snapshot.platform === 'win32' ? 'win32' : 'unix'}`)}</p>
            </div>
            {snapshot.platform === 'win32' && !snapshot.elevated && (
              <button className="btn btn--secondary" onClick={() => void api.relaunchElevated()}>
                <Icon name="shield" size={16} /> {t('settings.relaunchAdmin')}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
