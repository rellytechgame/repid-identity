/** System notifications are raised by the main process, which has no i18next: the few texts live here. */
const MESSAGES = {
  es: {
    boostOn: { title: 'Modo rendimiento activado', body: '{name} está abierto: RePID priorizó el juego y calmó {count} apps en segundo plano. Se desactiva solo al cerrarlo.' },
    memoryGrowth: { title: '{name} no deja de crecer en memoria', body: 'Pasó de {from} a {to} en 30 minutos. Reiniciarlo suele liberar esa memoria.' },
    diskLow: { title: 'Tu disco {drive} está casi lleno', body: 'Usado al {pct} %, quedan {free}. Abre RePID → Disco para ver qué ocupa espacio.' },
    cleaned: { title: 'Limpieza programada terminada', body: 'RePID liberó {size} limpiando solo lo seguro.' }
  },
  en: {
    boostOn: { title: 'Performance mode on', body: '{name} is open: RePID prioritized the game and calmed {count} background apps. It turns off when you close it.' },
    memoryGrowth: { title: '{name} keeps growing in memory', body: 'It went from {from} to {to} in 30 minutes. Restarting it usually frees that memory.' },
    diskLow: { title: 'Your {drive} drive is almost full', body: '{pct}% used, {free} left. Open RePID → Disk to see what takes the space.' },
    cleaned: { title: 'Scheduled cleanup finished', body: 'RePID freed {size} cleaning only safe items.' }
  }
} as const

export type MessageKey = keyof (typeof MESSAGES)['en']

export function message(language: string, key: MessageKey, params: Record<string, string>): { title: string; body: string } {
  const table = language.toLowerCase().startsWith('es') ? MESSAGES.es : MESSAGES.en
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? '')
  return { title: fill(table[key].title), body: fill(table[key].body) }
}
