use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::local_store::{resolve_store_file, LocalStoreState};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageOption {
    pub code: String,
    pub native_label: String,
    pub label_key: String,
    pub bcp47_tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nBundlePayload {
    pub preference: String,
    pub resolved_language: String,
    pub bcp47_tag: String,
    pub strings: HashMap<String, String>,
    pub fallback_strings: HashMap<String, String>,
    pub supported_languages: Vec<LanguageOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLocaleStrings {
    pub open_cadence: String,
    pub check_updates: String,
    pub quit_cadence: String,
    pub tooltip: String,
    pub window_title: String,
}

static EN_JSON: &str = include_str!("../../public/locales/en.json");
static ZH_HANT_JSON: &str = include_str!("../../public/locales/zh-Hant.json");
static ZH_HANS_JSON: &str = include_str!("../../public/locales/zh-Hans.json");
static JA_JSON: &str = include_str!("../../public/locales/ja.json");
static KO_JSON: &str = include_str!("../../public/locales/ko.json");
static ES_JSON: &str = include_str!("../../public/locales/es.json");
static DE_JSON: &str = include_str!("../../public/locales/de.json");
static FR_JSON: &str = include_str!("../../public/locales/fr.json");
static PT_JSON: &str = include_str!("../../public/locales/pt.json");
static IT_JSON: &str = include_str!("../../public/locales/it.json");
static VI_JSON: &str = include_str!("../../public/locales/vi.json");
static TH_JSON: &str = include_str!("../../public/locales/th.json");
static ID_JSON: &str = include_str!("../../public/locales/id.json");

static CATALOG_CACHE: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();

fn parse_catalog(raw: &str) -> HashMap<String, String> {
    serde_json::from_str::<HashMap<String, String>>(raw).unwrap_or_default()
}

fn catalogs() -> &'static HashMap<String, HashMap<String, String>> {
    CATALOG_CACHE.get_or_init(|| {
        let mut map = HashMap::with_capacity(13);
        map.insert("en".to_string(), parse_catalog(EN_JSON));
        map.insert("zh-Hant".to_string(), parse_catalog(ZH_HANT_JSON));
        map.insert("zh-Hans".to_string(), parse_catalog(ZH_HANS_JSON));
        map.insert("ja".to_string(), parse_catalog(JA_JSON));
        map.insert("ko".to_string(), parse_catalog(KO_JSON));
        map.insert("es".to_string(), parse_catalog(ES_JSON));
        map.insert("de".to_string(), parse_catalog(DE_JSON));
        map.insert("fr".to_string(), parse_catalog(FR_JSON));
        map.insert("pt".to_string(), parse_catalog(PT_JSON));
        map.insert("it".to_string(), parse_catalog(IT_JSON));
        map.insert("vi".to_string(), parse_catalog(VI_JSON));
        map.insert("th".to_string(), parse_catalog(TH_JSON));
        map.insert("id".to_string(), parse_catalog(ID_JSON));
        map
    })
}

pub fn supported_languages() -> Vec<LanguageOption> {
    vec![
        LanguageOption {
            code: "system".to_string(),
            native_label: "System Default".to_string(),
            label_key: "lang_system_default".to_string(),
            bcp47_tag: "".to_string(),
        },
        LanguageOption {
            code: "en".to_string(),
            native_label: "English".to_string(),
            label_key: "lang_english".to_string(),
            bcp47_tag: "en-US".to_string(),
        },
        LanguageOption {
            code: "zh-Hant".to_string(),
            native_label: "繁體中文".to_string(),
            label_key: "lang_zh_hant".to_string(),
            bcp47_tag: "zh-Hant".to_string(),
        },
        LanguageOption {
            code: "zh-Hans".to_string(),
            native_label: "简体中文".to_string(),
            label_key: "lang_zh_hans".to_string(),
            bcp47_tag: "zh-Hans".to_string(),
        },
        LanguageOption {
            code: "ja".to_string(),
            native_label: "日本語".to_string(),
            label_key: "lang_japanese".to_string(),
            bcp47_tag: "ja-JP".to_string(),
        },
        LanguageOption {
            code: "ko".to_string(),
            native_label: "한국어".to_string(),
            label_key: "lang_korean".to_string(),
            bcp47_tag: "ko-KR".to_string(),
        },
        LanguageOption {
            code: "es".to_string(),
            native_label: "Español".to_string(),
            label_key: "lang_spanish".to_string(),
            bcp47_tag: "es-ES".to_string(),
        },
        LanguageOption {
            code: "de".to_string(),
            native_label: "Deutsch".to_string(),
            label_key: "lang_german".to_string(),
            bcp47_tag: "de-DE".to_string(),
        },
        LanguageOption {
            code: "fr".to_string(),
            native_label: "Français".to_string(),
            label_key: "lang_french".to_string(),
            bcp47_tag: "fr-FR".to_string(),
        },
        LanguageOption {
            code: "pt".to_string(),
            native_label: "Português".to_string(),
            label_key: "lang_portuguese".to_string(),
            bcp47_tag: "pt-BR".to_string(),
        },
        LanguageOption {
            code: "it".to_string(),
            native_label: "Italiano".to_string(),
            label_key: "lang_italian".to_string(),
            bcp47_tag: "it-IT".to_string(),
        },
        LanguageOption {
            code: "vi".to_string(),
            native_label: "Tiếng Việt".to_string(),
            label_key: "lang_vietnamese".to_string(),
            bcp47_tag: "vi-VN".to_string(),
        },
        LanguageOption {
            code: "th".to_string(),
            native_label: "ไทย".to_string(),
            label_key: "lang_thai".to_string(),
            bcp47_tag: "th-TH".to_string(),
        },
        LanguageOption {
            code: "id".to_string(),
            native_label: "Bahasa Indonesia".to_string(),
            label_key: "lang_indonesian".to_string(),
            bcp47_tag: "id-ID".to_string(),
        },
    ]
}

pub fn normalize_language_code(raw: &str) -> String {
    let cleaned = raw.trim().replace('_', "-").to_ascii_lowercase();
    if cleaned.is_empty() || cleaned == "system" || cleaned == "default" {
        return "system".to_string();
    }

    if cleaned.starts_with("zh") {
        if cleaned.contains("hant")
            || cleaned.contains("-tw")
            || cleaned.contains("-hk")
            || cleaned.contains("-mo")
        {
            return "zh-Hant".to_string();
        }
        return "zh-Hans".to_string();
    }

    let primary = cleaned.split(['-', '.']).next().unwrap_or("");
    match primary {
        "en" => "en".to_string(),
        "ja" | "jp" => "ja".to_string(),
        "ko" | "kr" => "ko".to_string(),
        "es" => "es".to_string(),
        "de" => "de".to_string(),
        "fr" => "fr".to_string(),
        "pt" => "pt".to_string(),
        "it" => "it".to_string(),
        "vi" => "vi".to_string(),
        "th" => "th".to_string(),
        "id" | "in" => "id".to_string(),
        _ => "en".to_string(),
    }
}

pub fn detect_os_locale_tag() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Some(tag) = detect_windows_user_locale() {
            return tag;
        }
    }

    for var in ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"] {
        if let Ok(val) = std::env::var(var) {
            let trimmed = val.trim();
            if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("C") && !trimmed.eq_ignore_ascii_case("POSIX") {
                return trimmed.split(':').next().unwrap_or(trimmed).to_string();
            }
        }
    }

    "en-US".to_string()
}

#[cfg(target_os = "windows")]
fn detect_windows_user_locale() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(intl) = hkcu.open_subkey("Control Panel\\International") {
        if let Ok(locale_name) = intl.get_value::<String, _>("LocaleName") {
            let trimmed = locale_name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

pub fn resolve_effective_language(preference: &str, client_hint: Option<&str>) -> String {
    let normalized_pref = normalize_language_code(preference);
    if normalized_pref != "system" {
        return normalized_pref;
    }

    if let Some(hint) = client_hint {
        let trimmed = hint.trim();
        if !trimmed.is_empty() {
            let resolved_hint = normalize_language_code(trimmed);
            if resolved_hint != "system" {
                return resolved_hint;
            }
        }
    }

    let os_tag = detect_os_locale_tag();
    let resolved_os = normalize_language_code(&os_tag);
    if resolved_os == "system" {
        "en".to_string()
    } else {
        resolved_os
    }
}

pub fn bcp47_for_language(resolved: &str) -> String {
    match resolved {
        "zh-Hant" => "zh-Hant",
        "zh-Hans" => "zh-Hans",
        "ja" => "ja-JP",
        "ko" => "ko-KR",
        "es" => "es-ES",
        "de" => "de-DE",
        "fr" => "fr-FR",
        "pt" => "pt-BR",
        "it" => "it-IT",
        "vi" => "vi-VN",
        "th" => "th-TH",
        "id" => "id-ID",
        _ => "en-US",
    }
    .to_string()
}

pub fn translate_key(lang: &str, key: &str, args: &[&str]) -> String {
    let all = catalogs();
    let resolved = if lang == "system" { "en" } else { lang };
    let template = all
        .get(resolved)
        .and_then(|c| c.get(key))
        .or_else(|| all.get("en").and_then(|c| c.get(key)))
        .map(String::as_str)
        .unwrap_or(key);

    format_positional(template, args)
}

pub fn format_positional(template: &str, args: &[&str]) -> String {
    let mut result = template.to_string();
    for (idx, val) in args.iter().enumerate() {
        let pos = idx + 1;
        for spec in ["s", "d"] {
            let token = format!("%{pos}${spec}");
            if result.contains(&token) {
                result = result.replace(&token, val);
            }
        }
    }
    result
}

pub fn build_i18n_bundle(preference: &str, client_hint: Option<&str>) -> I18nBundlePayload {
    let normalized_pref = normalize_language_code(preference);
    let resolved = resolve_effective_language(&normalized_pref, client_hint);
    let all = catalogs();
    let fallback_strings = all.get("en").cloned().unwrap_or_default();
    let strings = all.get(&resolved).cloned().unwrap_or_else(|| fallback_strings.clone());

    I18nBundlePayload {
        preference: normalized_pref,
        resolved_language: resolved.clone(),
        bcp47_tag: bcp47_for_language(&resolved),
        strings,
        fallback_strings,
        supported_languages: supported_languages(),
    }
}

pub fn get_tray_locale_strings(resolved_lang: &str) -> TrayLocaleStrings {
    let open_cadence = match resolved_lang {
        "zh-Hant" => "開啟 Cadence",
        "zh-Hans" => "打开 Cadence",
        "ja" => "Cadence を開く",
        "ko" => "Cadence 열기",
        "es" => "Abrir Cadence",
        "de" => "Cadence öffnen",
        "fr" => "Ouvrir Cadence",
        "pt" => "Abrir Cadence",
        "it" => "Apri Cadence",
        "vi" => "Mở Cadence",
        "th" => "เปิด Cadence",
        "id" => "Buka Cadence",
        _ => "Open Cadence",
    };

    let quit_cadence = match resolved_lang {
        "zh-Hant" => "結束 Cadence",
        "zh-Hans" => "退出 Cadence",
        "ja" => "Cadence を終了",
        "ko" => "Cadence 종료",
        "es" => "Salir de Cadence",
        "de" => "Cadence beenden",
        "fr" => "Quitter Cadence",
        "pt" => "Sair do Cadence",
        "it" => "Esci da Cadence",
        "vi" => "Thoát Cadence",
        "th" => "ออกจาก Cadence",
        "id" => "Keluar dari Cadence",
        _ => "Quit Cadence",
    };

    let check_updates = translate_key(resolved_lang, "check_for_updates", &[]);
    let tagline = translate_key(resolved_lang, "tagline", &[]);
    let title = format!("Cadence — {tagline}");

    TrayLocaleStrings {
        open_cadence: open_cadence.to_string(),
        check_updates,
        quit_cadence: quit_cadence.to_string(),
        tooltip: title.clone(),
        window_title: title,
    }
}

#[tauri::command]
pub fn get_i18n_bundle_cmd(
    app: AppHandle,
    store: State<'_, LocalStoreState>,
    preference: Option<String>,
    client_hint: Option<String>,
) -> I18nBundlePayload {
    let path = resolve_store_file(&app);
    let stored_pref = store.load_language_preference(path.as_deref());
    let effective_pref = preference
        .or(stored_pref)
        .unwrap_or_else(|| "system".to_string());
    build_i18n_bundle(&effective_pref, client_hint.as_deref())
}

#[tauri::command]
pub fn save_language_preference_cmd(
    app: AppHandle,
    store: State<'_, LocalStoreState>,
    language: String,
    client_hint: Option<String>,
) -> I18nBundlePayload {
    let path = resolve_store_file(&app);
    let normalized = normalize_language_code(&language);
    store.save_language_preference(path.as_deref(), &normalized);
    build_i18n_bundle(&normalized, client_hint.as_deref())
}

#[tauri::command]
pub fn get_supported_languages_cmd() -> Vec<LanguageOption> {
    supported_languages()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_chinese_and_regional_locale_variants() {
        assert_eq!(normalize_language_code("zh_TW"), "zh-Hant");
        assert_eq!(normalize_language_code("zh-Hant-HK"), "zh-Hant");
        assert_eq!(normalize_language_code("zh-CN"), "zh-Hans");
        assert_eq!(normalize_language_code("zh_SG"), "zh-Hans");
        assert_eq!(normalize_language_code("ja_JP.UTF-8"), "ja");
        assert_eq!(normalize_language_code("ko-KR"), "ko");
        assert_eq!(normalize_language_code("es-MX"), "es");
        assert_eq!(normalize_language_code("de_AT"), "de");
        assert_eq!(normalize_language_code("fr-CA"), "fr");
        assert_eq!(normalize_language_code("pt-BR"), "pt");
        assert_eq!(normalize_language_code("it-IT"), "it");
        assert_eq!(normalize_language_code("vi-VN"), "vi");
        assert_eq!(normalize_language_code("th-TH"), "th");
        assert_eq!(normalize_language_code("in-ID"), "id");
        assert_eq!(normalize_language_code("system"), "system");
    }

    #[test]
    fn all_13_embedded_catalogs_have_full_key_parity() {
        let all = catalogs();
        assert_eq!(all.len(), 13);
        let en = all.get("en").expect("English catalog must exist");
        assert!(en.len() >= 600);
        for lang in [
            "en", "zh-Hant", "zh-Hans", "ja", "ko", "es", "de", "fr", "pt", "it", "vi", "th", "id",
        ] {
            let map = all.get(lang).unwrap_or_else(|| panic!("Missing {lang} catalog"));
            assert_eq!(
                map.len(),
                en.len(),
                "Catalog {lang} key count {} differs from English {}",
                map.len(),
                en.len()
            );
        }
    }

    #[test]
    fn formats_positional_android_style_placeholders() {
        let formatted = format_positional("Generated %1$d assigned + %2$d open; resolved %3$d overlaps.", &["5", "2", "1"]);
        assert_eq!(
            formatted,
            "Generated 5 assigned + 2 open; resolved 1 overlaps."
        );

        let zh = translate_key("zh-Hant", "welcome_back_format", &["王小明"]);
        assert_eq!(zh, "歡迎回來，王小明");
        let ja = translate_key("ja", "nav_overview", &[]);
        assert!(!ja.is_empty());
    }

    #[test]
    fn resolves_system_hint_and_builds_tray_labels() {
        let bundle = build_i18n_bundle("system", Some("ko-KR"));
        assert_eq!(bundle.resolved_language, "ko");
        assert_eq!(bundle.bcp47_tag, "ko-KR");
        assert!(!bundle.strings.is_empty());

        let tray = get_tray_locale_strings("zh-Hant");
        assert_eq!(tray.open_cadence, "開啟 Cadence");
        assert_eq!(tray.quit_cadence, "結束 Cadence");
    }
}
