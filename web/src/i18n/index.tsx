import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { TranslationKey, Translations } from './types'
import { fr } from './locales/fr'

export type Lang =
  | 'fr' | 'en' | 'es' | 'pt' | 'de' | 'it' | 'nl' | 'pl'
  | 'ru' | 'uk' | 'tr' | 'ar' | 'ja' | 'ko' | 'zh' | 'hi'
  | 'vi' | 'id' | 'sv' | 'no' | 'da' | 'ro' | 'cs' | 'el'
  | 'hu' | 'fi' | 'th'

export interface LangMeta {
  code: Lang
  label: string
  flag: string
  dir?: 'rtl'
}

export const LANGUAGES: LangMeta[] = [
  { code: 'fr', label: 'Français',            flag: '🇫🇷' },
  { code: 'en', label: 'English',             flag: '🇬🇧' },
  { code: 'es', label: 'Español',             flag: '🇪🇸' },
  { code: 'pt', label: 'Português',           flag: '🇧🇷' },
  { code: 'de', label: 'Deutsch',             flag: '🇩🇪' },
  { code: 'it', label: 'Italiano',            flag: '🇮🇹' },
  { code: 'nl', label: 'Nederlands',          flag: '🇳🇱' },
  { code: 'pl', label: 'Polski',              flag: '🇵🇱' },
  { code: 'ru', label: 'Русский',             flag: '🇷🇺' },
  { code: 'uk', label: 'Українська',          flag: '🇺🇦' },
  { code: 'tr', label: 'Türkçe',              flag: '🇹🇷' },
  { code: 'ar', label: 'العربية',             flag: '🇸🇦', dir: 'rtl' },
  { code: 'ja', label: '日本語',               flag: '🇯🇵' },
  { code: 'ko', label: '한국어',               flag: '🇰🇷' },
  { code: 'zh', label: '中文',                flag: '🇨🇳' },
  { code: 'hi', label: 'हिन्दी',              flag: '🇮🇳' },
  { code: 'vi', label: 'Tiếng Việt',          flag: '🇻🇳' },
  { code: 'id', label: 'Bahasa Indonesia',    flag: '🇮🇩' },
  { code: 'sv', label: 'Svenska',             flag: '🇸🇪' },
  { code: 'no', label: 'Norsk',               flag: '🇳🇴' },
  { code: 'da', label: 'Dansk',               flag: '🇩🇰' },
  { code: 'ro', label: 'Română',              flag: '🇷🇴' },
  { code: 'cs', label: 'Čeština',             flag: '🇨🇿' },
  { code: 'el', label: 'Ελληνικά',            flag: '🇬🇷' },
  { code: 'hu', label: 'Magyar',              flag: '🇭🇺' },
  { code: 'fi', label: 'Suomi',               flag: '🇫🇮' },
  { code: 'th', label: 'ภาษาไทย',             flag: '🇹🇭' },
]

const STORAGE_KEY = 'ss_lang'

async function loadLocale(lang: Lang): Promise<Translations> {
  try {
    switch (lang) {
      case 'fr': return (await import('./locales/fr')).fr
      case 'en': return (await import('./locales/en')).en
      case 'es': return (await import('./locales/es')).es
      case 'pt': return (await import('./locales/pt')).pt
      case 'de': return (await import('./locales/de')).de
      case 'it': return (await import('./locales/it')).it
      case 'nl': return (await import('./locales/nl')).nl
      case 'pl': return (await import('./locales/pl')).pl
      case 'ru': return (await import('./locales/ru')).ru
      case 'uk': return (await import('./locales/uk')).uk
      case 'tr': return (await import('./locales/tr')).tr
      case 'ar': return (await import('./locales/ar')).ar
      case 'ja': return (await import('./locales/ja')).ja
      case 'ko': return (await import('./locales/ko')).ko
      case 'zh': return (await import('./locales/zh')).zh
      case 'hi': return (await import('./locales/hi')).hi
      case 'vi': return (await import('./locales/vi')).vi
      case 'id': return (await import('./locales/id')).id
      case 'sv': return (await import('./locales/sv')).sv
      case 'no': return (await import('./locales/no')).no
      case 'da': return (await import('./locales/da')).da
      case 'ro': return (await import('./locales/ro')).ro
      case 'cs': return (await import('./locales/cs')).cs
      case 'el': return (await import('./locales/el')).el
      case 'hu': return (await import('./locales/hu')).hu
      case 'fi': return (await import('./locales/fi')).fi
      case 'th': return (await import('./locales/th')).th
      default:   return fr
    }
  } catch {
    return fr
  }
}

interface I18nCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string>) => string
}

const Ctx = createContext<I18nCtx>({
  lang: 'fr',
  setLang: () => {},
  t: (k) => k,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const saved = (localStorage.getItem(STORAGE_KEY) as Lang | null)
  const [lang, setLangState]         = useState<Lang>(saved ?? 'fr')
  const [translations, setTranslations] = useState<Translations>(fr)
  const [loading, setLoading]         = useState(false)

  const setLang = useCallback((l: Lang) => {
    if (l === lang) return
    setLoading(true)
    loadLocale(l).then(data => {
      setTranslations(data)
      setLangState(l)
      localStorage.setItem(STORAGE_KEY, l)
      // RTL support
      const meta = LANGUAGES.find(x => x.code === l)
      document.documentElement.dir = meta?.dir ?? 'ltr'
    }).finally(() => setLoading(false))
  }, [lang])

  const t = useCallback((key: TranslationKey, vars?: Record<string, string>): string => {
    let str = translations[key] ?? key
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => { str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v) })
    }
    return str
  }, [translations])

  if (loading) {
    return (
      <div style={{ background: '#111', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #2a2a2a', borderTopColor: '#f0a830', animation: 'spin 0.6s linear infinite' }} />
      </div>
    )
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export function useI18n() { return useContext(Ctx) }
