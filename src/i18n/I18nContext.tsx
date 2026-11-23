import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  invokeGetI18nBundle,
  invokeSaveLanguagePreference,
  isTauriDesktop,
} from '../utils/tauriBridge';

export const LANGUAGE_STORAGE_KEY = 'cadence_language_v1';

export type SupportedLanguageCode =
  | 'en'
  | 'zh-Hant'
  | 'zh-Hans'
  | 'ja'
  | 'ko'
  | 'es'
  | 'de'
  | 'fr'
  | 'pt'
  | 'it'
  | 'vi'
  | 'th'
  | 'id';

export type LanguagePreference = 'system' | SupportedLanguageCode;

export interface LanguageCatalogOption {
  code: LanguagePreference;
  nativeLabel: string;
  labelKey: string;
  bcp47Tag: string;
}

export const SUPPORTED_LANGUAGES: LanguageCatalogOption[] = [
  { code: 'system', nativeLabel: 'System Default', labelKey: 'lang_system_default', bcp47Tag: '' },
  { code: 'en', nativeLabel: 'English', labelKey: 'lang_english', bcp47Tag: 'en-US' },
  { code: 'zh-Hant', nativeLabel: '繁體中文', labelKey: 'lang_zh_hant', bcp47Tag: 'zh-Hant' },
  { code: 'zh-Hans', nativeLabel: '简体中文', labelKey: 'lang_zh_hans', bcp47Tag: 'zh-Hans' },
  { code: 'ja', nativeLabel: '日本語', labelKey: 'lang_japanese', bcp47Tag: 'ja-JP' },
  { code: 'ko', nativeLabel: '한국어', labelKey: 'lang_korean', bcp47Tag: 'ko-KR' },
  { code: 'es', nativeLabel: 'Español', labelKey: 'lang_spanish', bcp47Tag: 'es-ES' },
  { code: 'de', nativeLabel: 'Deutsch', labelKey: 'lang_german', bcp47Tag: 'de-DE' },
  { code: 'fr', nativeLabel: 'Français', labelKey: 'lang_french', bcp47Tag: 'fr-FR' },
  { code: 'pt', nativeLabel: 'Português', labelKey: 'lang_portuguese', bcp47Tag: 'pt-BR' },
  { code: 'it', nativeLabel: 'Italiano', labelKey: 'lang_italian', bcp47Tag: 'it-IT' },
  { code: 'vi', nativeLabel: 'Tiếng Việt', labelKey: 'lang_vietnamese', bcp47Tag: 'vi-VN' },
  { code: 'th', nativeLabel: 'ไทย', labelKey: 'lang_thai', bcp47Tag: 'th-TH' },
  { code: 'id', nativeLabel: 'Bahasa Indonesia', labelKey: 'lang_indonesian', bcp47Tag: 'id-ID' },
];

const BCP47_MAP: Record<SupportedLanguageCode, string> = {
  en: 'en-US',
  'zh-Hant': 'zh-Hant',
  'zh-Hans': 'zh-Hans',
  ja: 'ja-JP',
  ko: 'ko-KR',
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
  pt: 'pt-BR',
  it: 'it-IT',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
};

export function normalizeLanguagePreference(raw?: string | null): LanguagePreference {
  if (!raw) return 'system';
  const cleaned = raw.trim().replace(/_/g, '-').toLowerCase();
  if (!cleaned || cleaned === 'system' || cleaned === 'default') return 'system';
  return normalizeConcreteLanguage(cleaned);
}

export function normalizeConcreteLanguage(raw?: string | null): SupportedLanguageCode {
  if (!raw) return 'en';
  const cleaned = raw.trim().replace(/_/g, '-').toLowerCase();
  if (cleaned.startsWith('zh')) {
    if (
      cleaned.includes('hant') ||
      cleaned.includes('-tw') ||
      cleaned.includes('-hk') ||
      cleaned.includes('-mo')
    ) {
      return 'zh-Hant';
    }
    return 'zh-Hans';
  }
  const primary = cleaned.split(/[-.]/)[0];
  switch (primary) {
    case 'zh-hant':
      return 'zh-Hant';
    case 'zh-hans':
      return 'zh-Hans';
    case 'ja':
    case 'jp':
      return 'ja';
    case 'ko':
    case 'kr':
      return 'ko';
    case 'es':
      return 'es';
    case 'de':
      return 'de';
    case 'fr':
      return 'fr';
    case 'pt':
      return 'pt';
    case 'it':
      return 'it';
    case 'vi':
      return 'vi';
    case 'th':
      return 'th';
    case 'id':
    case 'in':
      return 'id';
    default:
      return 'en';
  }
}

function getBrowserLocaleHint(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  return (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';
}

export function resolveEffectiveLanguage(pref: LanguagePreference): SupportedLanguageCode {
  if (pref !== 'system') return pref;
  return normalizeConcreteLanguage(getBrowserLocaleHint());
}

export function formatPositionalTemplate(
  template: string,
  args: Array<string | number>,
): string {
  if (!args.length) return template;
  let out = template;
  args.forEach((val, idx) => {
    const pos = idx + 1;
    const str = String(val);
    out = out.replaceAll(`%${pos}$s`, str).replaceAll(`%${pos}$d`, str);
  });
  return out;
}

const catalogCache = new Map<SupportedLanguageCode, Record<string, string>>();
let activeStringsSnapshot: Record<string, string> = {};
let fallbackStringsSnapshot: Record<string, string> = {};
let activeBcp47Tag = 'en-US';

async function fetchJsonLocale(lang: SupportedLanguageCode): Promise<Record<string, string>> {
  const cached = catalogCache.get(lang);
  if (cached) return cached;
  try {
    const res = await fetch(`/locales/${encodeURIComponent(lang)}.json`);
    if (!res.ok) return {};
    const parsed = (await res.json()) as Record<string, string>;
    catalogCache.set(lang, parsed);
    return parsed;
  } catch {
    return {};
  }
}

export function translateStatic(
  key: string,
  ...args: Array<string | number>
): string {
  const tpl = activeStringsSnapshot[key] ?? fallbackStringsSnapshot[key] ?? key;
  return formatPositionalTemplate(tpl, args);
}

export function getCurrentBcp47Tag(): string {
  return activeBcp47Tag;
}

function readStoredPreference(): LanguagePreference {
  try {
    return normalizeLanguagePreference(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

interface I18nContextValue {
  preference: LanguagePreference;
  resolvedLanguage: SupportedLanguageCode;
  bcp47Tag: string;
  languages: LanguageCatalogOption[];
  ready: boolean;
  setLanguagePreference: (next: LanguagePreference) => Promise<void>;
  t: (key: string, ...args: Array<string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<LanguagePreference>(readStoredPreference);
  const [resolvedLanguage, setResolvedLanguage] = useState<SupportedLanguageCode>(() =>
    resolveEffectiveLanguage(readStoredPreference()),
  );
  const [strings, setStrings] = useState<Record<string, string>>({});
  const [fallbackStrings, setFallbackStrings] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  const applyResolvedBundle = useCallback(
    (
      pref: LanguagePreference,
      resolved: SupportedLanguageCode,
      nextStrings: Record<string, string>,
      nextFallback: Record<string, string>,
    ) => {
      const bcp47 = BCP47_MAP[resolved] ?? 'en-US';
      activeStringsSnapshot = nextStrings;
      fallbackStringsSnapshot = nextFallback;
      activeBcp47Tag = bcp47;
      setPreference(pref);
      setResolvedLanguage(resolved);
      setStrings(nextStrings);
      setFallbackStrings(nextFallback);
      setReady(true);

      if (typeof document !== 'undefined') {
        document.documentElement.lang = bcp47;
        const tagline = nextStrings.tagline ?? nextFallback.tagline;
        if (tagline) {
          document.title = `Cadence — ${tagline}`;
        }
      }
      if (isTauriDesktop()) {
        const tagline = nextStrings.tagline ?? nextFallback.tagline;
        if (tagline) {
          void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            void getCurrentWindow().setTitle(`Cadence — ${tagline}`);
          });
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const hint = getBrowserLocaleHint();
    const initialPref = readStoredPreference();

    const hydrate = async () => {
      if (isTauriDesktop()) {
        const rustBundle = await invokeGetI18nBundle(
          initialPref === 'system' ? undefined : initialPref,
          hint,
        );
        if (!cancelled && rustBundle) {
          const pref = normalizeLanguagePreference(rustBundle.preference);
          const resolved = normalizeConcreteLanguage(rustBundle.resolvedLanguage);
          try {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, pref);
          } catch {
            // ignore storage errors
          }
          applyResolvedBundle(
            pref,
            resolved,
            rustBundle.strings,
            rustBundle.fallbackStrings,
          );
          return;
        }
      }

      const targetLang = resolveEffectiveLanguage(initialPref);
      const [enDict, targetDict] = await Promise.all([
        fetchJsonLocale('en'),
        targetLang === 'en' ? fetchJsonLocale('en') : fetchJsonLocale(targetLang),
      ]);
      if (!cancelled) {
        applyResolvedBundle(
          initialPref,
          targetLang,
          Object.keys(targetDict).length > 0 ? targetDict : enDict,
          enDict,
        );
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [applyResolvedBundle]);

  const setLanguagePreference = useCallback(
    async (next: LanguagePreference) => {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      } catch {
        // ignore storage errors
      }
      const hint = getBrowserLocaleHint();

      if (isTauriDesktop()) {
        const rustBundle = await invokeSaveLanguagePreference(next, hint);
        if (rustBundle) {
          applyResolvedBundle(
            normalizeLanguagePreference(rustBundle.preference),
            normalizeConcreteLanguage(rustBundle.resolvedLanguage),
            rustBundle.strings,
            rustBundle.fallbackStrings,
          );
          return;
        }
      }

      const targetLang = resolveEffectiveLanguage(next);
      const [enDict, targetDict] = await Promise.all([
        Object.keys(fallbackStringsSnapshot).length > 0
          ? Promise.resolve(fallbackStringsSnapshot)
          : fetchJsonLocale('en'),
        targetLang === 'en' ? fetchJsonLocale('en') : fetchJsonLocale(targetLang),
      ]);
      applyResolvedBundle(
        next,
        targetLang,
        Object.keys(targetDict).length > 0 ? targetDict : enDict,
        enDict,
      );
    },
    [applyResolvedBundle],
  );

  const t = useCallback(
    (key: string, ...args: Array<string | number>) => {
      const tpl = strings[key] ?? fallbackStrings[key] ?? key;
      return formatPositionalTemplate(tpl, args);
    },
    [strings, fallbackStrings],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      preference,
      resolvedLanguage,
      bcp47Tag: BCP47_MAP[resolvedLanguage] ?? 'en-US',
      languages: SUPPORTED_LANGUAGES,
      ready,
      setLanguagePreference,
      t,
    }),
    [preference, resolvedLanguage, ready, setLanguagePreference, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      preference: 'system',
      resolvedLanguage: 'en',
      bcp47Tag: 'en-US',
      languages: SUPPORTED_LANGUAGES,
      ready: false,
      setLanguagePreference: async () => {},
      t: translateStatic,
    };
  }
  return ctx;
}
