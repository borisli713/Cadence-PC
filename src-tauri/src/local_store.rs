use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::fairness::default_week_slots;
use crate::models::{NotificationWorkPayload, PushNotificationRecord, WeekSlotConfig};
use crate::notifications::{filter_new_manager_work_alerts, filter_unnotified_alerts};
use crate::scheduler::validate_week_slots;

const MAX_SEEN_KEYS: usize = 250;
const STORE_FILENAME: &str = "cadence_desktop_state.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDesktopState {
    #[serde(default)]
    week_slots: Vec<WeekSlotConfig>,
    #[serde(default)]
    seen_notification_ids: HashMap<String, Vec<String>>,
    #[serde(default)]
    seen_manager_work_keys: HashMap<String, Vec<String>>,
    #[serde(default)]
    language_preference: Option<String>,
}

#[derive(Default)]
pub struct LocalStoreState {
    inner: Mutex<PersistedDesktopState>,
}

fn store_path_from_dir(dir: &Path) -> PathBuf {
    dir.join(STORE_FILENAME)
}

fn load_state_from_path(path: &Path) -> PersistedDesktopState {
    let Ok(bytes) = fs::read(path) else {
        return PersistedDesktopState::default();
    };
    serde_json::from_slice::<PersistedDesktopState>(&bytes).unwrap_or_default()
}

fn save_state_to_path(path: &Path, state: &PersistedDesktopState) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_vec_pretty(state) {
        let _ = fs::write(path, json);
    }
}

fn trim_vec(items: &mut Vec<String>) {
    if items.len() > MAX_SEEN_KEYS {
        let excess = items.len() - MAX_SEEN_KEYS;
        items.drain(0..excess);
    }
}

impl LocalStoreState {
    fn hydrate_from_disk_if_empty(&self, path: Option<&Path>) {
        let Some(p) = path else {
            return;
        };
        if let Ok(mut guard) = self.inner.lock() {
            if guard.week_slots.is_empty()
                && guard.seen_notification_ids.is_empty()
                && guard.seen_manager_work_keys.is_empty()
                && guard.language_preference.is_none()
                && p.exists()
            {
                *guard = load_state_from_path(p);
            }
        }
    }

    pub fn load_language_preference(&self, store_file: Option<&Path>) -> Option<String> {
        self.hydrate_from_disk_if_empty(store_file);
        if let Ok(guard) = self.inner.lock() {
            return guard.language_preference.clone();
        }
        None
    }

    pub fn save_language_preference(&self, store_file: Option<&Path>, language: &str) {
        self.hydrate_from_disk_if_empty(store_file);
        if let Ok(mut guard) = self.inner.lock() {
            guard.language_preference = Some(language.to_string());
            if let Some(p) = store_file {
                save_state_to_path(p, &guard);
            }
        }
    }

    pub fn load_week_slots(&self, store_file: Option<&Path>) -> Vec<WeekSlotConfig> {
        self.hydrate_from_disk_if_empty(store_file);
        if let Ok(guard) = self.inner.lock() {
            if !guard.week_slots.is_empty() {
                return guard.week_slots.clone();
            }
        }
        default_week_slots()
    }

    pub fn save_week_slots(
        &self,
        store_file: Option<&Path>,
        slots: Vec<WeekSlotConfig>,
    ) -> Result<Vec<WeekSlotConfig>, String> {
        validate_week_slots(&slots)?;
        if let Ok(mut guard) = self.inner.lock() {
            guard.week_slots = slots.clone();
            if let Some(p) = store_file {
                save_state_to_path(p, &guard);
            }
        }
        Ok(slots)
    }

    pub fn filter_fresh_notifications(
        &self,
        store_file: Option<&Path>,
        uid: &str,
        notifications: &[PushNotificationRecord],
        push_enabled: bool,
    ) -> Vec<PushNotificationRecord> {
        if !push_enabled || uid.trim().is_empty() {
            return Vec::new();
        }
        self.hydrate_from_disk_if_empty(store_file);

        let Ok(mut guard) = self.inner.lock() else {
            return Vec::new();
        };
        let seen_list = guard
            .seen_notification_ids
            .entry(uid.to_string())
            .or_default();
        let seen_set: HashSet<String> = seen_list.iter().cloned().collect();
        let fresh: Vec<PushNotificationRecord> =
            filter_unnotified_alerts(notifications, &seen_set, push_enabled)
                .into_iter()
                .cloned()
                .collect();

        if !fresh.is_empty() {
            for n in &fresh {
                if !seen_set.contains(&n.id) {
                    seen_list.push(n.id.clone());
                }
            }
            trim_vec(seen_list);
            if let Some(p) = store_file {
                save_state_to_path(p, &guard);
            }
        }

        fresh
    }

    pub fn filter_fresh_manager_work_alerts(
        &self,
        store_file: Option<&Path>,
        uid: &str,
        items: Vec<NotificationWorkPayload>,
        push_enabled: bool,
    ) -> Vec<NotificationWorkPayload> {
        if !push_enabled || uid.trim().is_empty() {
            return Vec::new();
        }
        self.hydrate_from_disk_if_empty(store_file);

        let Ok(mut guard) = self.inner.lock() else {
            return Vec::new();
        };
        let seen_list = guard
            .seen_manager_work_keys
            .entry(uid.to_string())
            .or_default();
        let seen_set: HashSet<String> = seen_list.iter().cloned().collect();
        let fresh = filter_new_manager_work_alerts(items, &seen_set, push_enabled);

        if !fresh.is_empty() {
            for item in &fresh {
                if !seen_set.contains(&item.key) {
                    seen_list.push(item.key.clone());
                }
            }
            trim_vec(seen_list);
            if let Some(p) = store_file {
                save_state_to_path(p, &guard);
            }
        }

        fresh
    }
}

pub(crate) fn resolve_store_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| store_path_from_dir(&dir))
}

#[tauri::command]
pub fn load_week_slots_cmd(app: AppHandle, store: State<'_, LocalStoreState>) -> Vec<WeekSlotConfig> {
    let path = resolve_store_file(&app);
    store.load_week_slots(path.as_deref())
}

#[tauri::command]
pub fn save_week_slots_cmd(
    app: AppHandle,
    store: State<'_, LocalStoreState>,
    slots: Vec<WeekSlotConfig>,
) -> Result<Vec<WeekSlotConfig>, String> {
    let path = resolve_store_file(&app);
    store.save_week_slots(path.as_deref(), slots)
}

#[tauri::command]
pub fn filter_unnotified_alerts_cmd(
    app: AppHandle,
    store: State<'_, LocalStoreState>,
    uid: String,
    notifications: Vec<PushNotificationRecord>,
    push_enabled: bool,
) -> Vec<PushNotificationRecord> {
    let path = resolve_store_file(&app);
    store.filter_fresh_notifications(path.as_deref(), &uid, &notifications, push_enabled)
}

#[tauri::command]
pub fn filter_new_manager_work_alerts_cmd(
    app: AppHandle,
    store: State<'_, LocalStoreState>,
    uid: String,
    items: Vec<NotificationWorkPayload>,
    push_enabled: bool,
) -> Vec<NotificationWorkPayload> {
    let path = resolve_store_file(&app);
    store.filter_fresh_manager_work_alerts(path.as_deref(), &uid, items, push_enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NotificationCategory;

    #[test]
    fn persists_week_slots_and_notification_deduplication_to_disk() {
        let test_dir = std::env::temp_dir().join(format!(
            "cadence_local_store_test_{}",
            std::process::id()
        ));
        let store_file = store_path_from_dir(&test_dir);
        let _ = fs::remove_file(&store_file);

        let store = LocalStoreState::default();
        assert_eq!(store.load_week_slots(Some(&store_file)).len(), 3);

        let custom = vec![WeekSlotConfig {
            id: "early".to_string(),
            label: "Early".to_string(),
            title: "Early Shift".to_string(),
            department: "Operations".to_string(),
            start_time: "06:00".to_string(),
            end_time: "14:00".to_string(),
        }];
        store
            .save_week_slots(Some(&store_file), custom)
            .expect("valid slots should save");

        let reloaded = LocalStoreState::default();
        let loaded_slots = reloaded.load_week_slots(Some(&store_file));
        assert_eq!(loaded_slots.len(), 1);
        assert_eq!(loaded_slots[0].id, "early");

        let notif = PushNotificationRecord {
            id: "n_1".to_string(),
            recipient_uid: "u1".to_string(),
            title: "Assigned".to_string(),
            message: "Morning shift".to_string(),
            category: NotificationCategory::ShiftAssigned,
            related_shift_id: "s1".to_string(),
            is_read: false,
            actor_uid: "mgr".to_string(),
        };
        let first = reloaded.filter_fresh_notifications(
            Some(&store_file),
            "u1",
            std::slice::from_ref(&notif),
            true,
        );
        assert_eq!(first.len(), 1);
        let second =
            reloaded.filter_fresh_notifications(Some(&store_file), "u1", &[notif], true);
        assert!(second.is_empty());

        let _ = fs::remove_dir_all(&test_dir);
    }
}
