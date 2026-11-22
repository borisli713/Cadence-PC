use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::fairness::{compute_shift_hours, default_week_slots};
use crate::models::{StaffDirectoryEntry, WeekSlotConfig};
use crate::scheduler::validate_week_slots;

const TEMPLATES_FILENAME: &str = "cadence_shift_templates.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShiftRotationTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub active_days_per_week: usize,
    pub slots: Vec<WeekSlotConfig>,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCapacityProjection {
    pub template_id: String,
    pub template_name: String,
    pub slots_per_day: usize,
    pub weekly_shifts_count: usize,
    pub required_weekly_hours: f64,
    pub team_weekly_capacity_hours: f64,
    pub coverage_ratio_percent: i64,
    pub deficit_or_surplus_hours: f64,
    pub sustainable: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTemplates {
    #[serde(default)]
    custom_templates: Vec<ShiftRotationTemplate>,
}

#[derive(Default)]
pub struct ShiftTemplatesState {
    inner: Mutex<PersistedTemplates>,
}

pub fn builtin_shift_templates() -> Vec<ShiftRotationTemplate> {
    vec![
        ShiftRotationTemplate {
            id: "builtin_standard_3shift".to_string(),
            name: "Standard 3-Shift Rotation".to_string(),
            description: "Balanced Morning, Midday Support, and Closing 8h coverage across 7 days."
                .to_string(),
            active_days_per_week: 7,
            slots: default_week_slots(),
            is_builtin: true,
        },
        ShiftRotationTemplate {
            id: "builtin_weekday_core".to_string(),
            name: "Weekday Core Business Hours".to_string(),
            description: "Two overlapping 8h daytime blocks tuned for Mon–Fri desk operations."
                .to_string(),
            active_days_per_week: 5,
            slots: vec![
                WeekSlotConfig {
                    id: "open_ops".to_string(),
                    label: "Opening Ops".to_string(),
                    title: "Opening Desk & Triage".to_string(),
                    department: "Operations".to_string(),
                    start_time: "08:00".to_string(),
                    end_time: "16:00".to_string(),
                },
                WeekSlotConfig {
                    id: "late_sup".to_string(),
                    label: "Afternoon Support".to_string(),
                    title: "Afternoon Client Support".to_string(),
                    department: "Support".to_string(),
                    start_time: "10:00".to_string(),
                    end_time: "18:00".to_string(),
                },
            ],
            is_builtin: true,
        },
        ShiftRotationTemplate {
            id: "builtin_24x7_ops".to_string(),
            name: "24/7 Continuous Operations".to_string(),
            description: "Continuous Morning, Evening, and Overnight rotation with zero coverage gaps."
                .to_string(),
            active_days_per_week: 7,
            slots: vec![
                WeekSlotConfig {
                    id: "day".to_string(),
                    label: "Day Shift".to_string(),
                    title: "Day Command Center".to_string(),
                    department: "Operations".to_string(),
                    start_time: "06:00".to_string(),
                    end_time: "14:00".to_string(),
                },
                WeekSlotConfig {
                    id: "swing".to_string(),
                    label: "Swing Shift".to_string(),
                    title: "Evening Command Center".to_string(),
                    department: "Operations".to_string(),
                    start_time: "14:00".to_string(),
                    end_time: "22:00".to_string(),
                },
                WeekSlotConfig {
                    id: "night".to_string(),
                    label: "Night Shift".to_string(),
                    title: "Overnight Command Center".to_string(),
                    department: "Operations".to_string(),
                    start_time: "22:00".to_string(),
                    end_time: "06:00".to_string(),
                },
            ],
            is_builtin: true,
        },
    ]
}

fn templates_path_from_dir(dir: &Path) -> PathBuf {
    dir.join(TEMPLATES_FILENAME)
}

fn resolve_templates_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| templates_path_from_dir(&dir))
}

fn load_templates_from_path(path: &Path) -> PersistedTemplates {
    let Ok(bytes) = fs::read(path) else {
        return PersistedTemplates::default();
    };
    serde_json::from_slice::<PersistedTemplates>(&bytes).unwrap_or_default()
}

fn save_templates_to_path(path: &Path, state: &PersistedTemplates) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_vec_pretty(state) {
        let _ = fs::write(path, json);
    }
}

pub fn validate_template(tpl: &ShiftRotationTemplate) -> Result<(), String> {
    if tpl.id.trim().is_empty() {
        return Err("Template ID cannot be empty.".to_string());
    }
    if tpl.name.trim().is_empty() || tpl.name.trim().chars().count() > 80 {
        return Err("Template name must be between 1 and 80 characters.".to_string());
    }
    if !(1..=7).contains(&tpl.active_days_per_week) {
        return Err("Active days per week must be between 1 and 7.".to_string());
    }
    validate_week_slots(&tpl.slots)?;
    let mut ids = HashSet::new();
    for slot in &tpl.slots {
        if !ids.insert(slot.id.trim().to_string()) {
            return Err(format!("Duplicate slot ID '{}' inside template.", slot.id));
        }
    }
    Ok(())
}

pub fn project_template_capacity(
    tpl: &ShiftRotationTemplate,
    staff_directory: &[StaffDirectoryEntry],
) -> TemplateCapacityProjection {
    let daily_hours: f64 = tpl
        .slots
        .iter()
        .map(|s| compute_shift_hours(&s.start_time, &s.end_time, 0))
        .sum();
    let days = tpl.active_days_per_week.clamp(1, 7) as f64;
    let required_weekly_hours = ((daily_hours * days) * 100.0).round() / 100.0;
    let team_weekly_capacity_hours: f64 = staff_directory
        .iter()
        .map(|m| m.weekly_hours_target.max(0.0))
        .sum();
    let rounded_capacity = (team_weekly_capacity_hours * 100.0).round() / 100.0;
    let delta = ((rounded_capacity - required_weekly_hours) * 100.0).round() / 100.0;
    let coverage_ratio_percent = if required_weekly_hours > 0.0 {
        ((rounded_capacity / required_weekly_hours) * 100.0).round() as i64
    } else {
        100
    };

    TemplateCapacityProjection {
        template_id: tpl.id.clone(),
        template_name: tpl.name.clone(),
        slots_per_day: tpl.slots.len(),
        weekly_shifts_count: tpl.slots.len() * tpl.active_days_per_week.clamp(1, 7),
        required_weekly_hours,
        team_weekly_capacity_hours: rounded_capacity,
        coverage_ratio_percent,
        deficit_or_surplus_hours: delta,
        sustainable: delta >= 0.0,
    }
}

impl ShiftTemplatesState {
    fn hydrate_if_empty(&self, path: Option<&Path>) {
        let Some(p) = path else {
            return;
        };
        if let Ok(mut guard) = self.inner.lock() {
            if guard.custom_templates.is_empty() && p.exists() {
                *guard = load_templates_from_path(p);
            }
        }
    }

    pub fn list_all(&self, store_file: Option<&Path>) -> Vec<ShiftRotationTemplate> {
        self.hydrate_if_empty(store_file);
        let mut all = builtin_shift_templates();
        if let Ok(guard) = self.inner.lock() {
            all.extend(guard.custom_templates.clone());
        }
        all
    }

    pub fn save_custom(
        &self,
        store_file: Option<&Path>,
        mut tpl: ShiftRotationTemplate,
    ) -> Result<Vec<ShiftRotationTemplate>, String> {
        tpl.is_builtin = false;
        tpl.name = tpl.name.trim().chars().take(80).collect();
        tpl.description = tpl.description.trim().chars().take(240).collect();
        validate_template(&tpl)?;
        if tpl.id.starts_with("builtin_") {
            return Err("Cannot overwrite built-in shift template IDs.".to_string());
        }

        self.hydrate_if_empty(store_file);
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(existing) = guard
                .custom_templates
                .iter_mut()
                .find(|t| t.id == tpl.id)
            {
                *existing = tpl;
            } else {
                guard.custom_templates.push(tpl);
            }
            if let Some(p) = store_file {
                save_templates_to_path(p, &guard);
            }
        }
        Ok(self.list_all(store_file))
    }

    pub fn delete_custom(&self, store_file: Option<&Path>, template_id: &str) -> Result<bool, String> {
        if template_id.starts_with("builtin_") {
            return Err("Built-in shift rotation templates cannot be deleted.".to_string());
        }
        self.hydrate_if_empty(store_file);
        let Ok(mut guard) = self.inner.lock() else {
            return Ok(false);
        };
        let before = guard.custom_templates.len();
        guard.custom_templates.retain(|t| t.id != template_id);
        let removed = guard.custom_templates.len() < before;
        if removed {
            if let Some(p) = store_file {
                save_templates_to_path(p, &guard);
            }
        }
        Ok(removed)
    }
}

#[tauri::command]
pub fn list_shift_templates_cmd(
    app: AppHandle,
    templates: State<'_, ShiftTemplatesState>,
) -> Vec<ShiftRotationTemplate> {
    let path = resolve_templates_file(&app);
    templates.list_all(path.as_deref())
}

#[tauri::command]
pub fn save_shift_template_cmd(
    app: AppHandle,
    templates: State<'_, ShiftTemplatesState>,
    template: ShiftRotationTemplate,
) -> Result<Vec<ShiftRotationTemplate>, String> {
    let path = resolve_templates_file(&app);
    templates.save_custom(path.as_deref(), template)
}

#[tauri::command]
pub fn delete_shift_template_cmd(
    app: AppHandle,
    templates: State<'_, ShiftTemplatesState>,
    template_id: String,
) -> Result<bool, String> {
    let path = resolve_templates_file(&app);
    templates.delete_custom(path.as_deref(), &template_id)
}

#[tauri::command]
pub fn project_template_capacity_cmd(
    template: ShiftRotationTemplate,
    staff_directory: Vec<StaffDirectoryEntry>,
) -> Result<TemplateCapacityProjection, String> {
    validate_template(&template)?;
    Ok(project_template_capacity(&template, &staff_directory))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserRole;

    fn mk_staff(uid: &str, target: f64) -> StaffDirectoryEntry {
        StaffDirectoryEntry {
            uid: uid.to_string(),
            display_name: uid.to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: 0.0,
            scheduled_hours_this_week: 0.0,
            weekly_hours_target: target,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        }
    }

    #[test]
    fn persists_custom_templates_and_protects_builtins() {
        let test_dir = std::env::temp_dir().join(format!(
            "cadence_templates_test_{}",
            std::process::id()
        ));
        let file = templates_path_from_dir(&test_dir);
        let _ = fs::remove_file(&file);

        let state = ShiftTemplatesState::default();
        assert_eq!(state.list_all(Some(&file)).len(), 3);
        assert!(state.delete_custom(Some(&file), "builtin_standard_3shift").is_err());

        let custom = ShiftRotationTemplate {
            id: "custom_weekend".to_string(),
            name: "Weekend Dual Block".to_string(),
            description: "Sat-Sun 10h coverage".to_string(),
            active_days_per_week: 2,
            slots: vec![WeekSlotConfig {
                id: "wknd_day".to_string(),
                label: "Weekend".to_string(),
                title: "Weekend Floor Lead".to_string(),
                department: "Operations".to_string(),
                start_time: "08:00".to_string(),
                end_time: "18:00".to_string(),
            }],
            is_builtin: false,
        };
        state.save_custom(Some(&file), custom).expect("valid template saves");

        let reloaded = ShiftTemplatesState::default();
        let all = reloaded.list_all(Some(&file));
        assert_eq!(all.len(), 4);
        assert_eq!(all[3].id, "custom_weekend");

        assert!(reloaded.delete_custom(Some(&file), "custom_weekend").unwrap());
        assert_eq!(reloaded.list_all(Some(&file)).len(), 3);

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn projects_weekly_staffing_capacity_ratio_accurately() {
        let builtins = builtin_shift_templates();
        let std_3 = &builtins[0]; // 3 slots * 8h * 7 days = 168h/wk
        let team = vec![
            mk_staff("u1", 40.0),
            mk_staff("u2", 40.0),
            mk_staff("u3", 40.0),
            mk_staff("u4", 40.0),
            mk_staff("u5", 20.0),
        ];
        let proj = project_template_capacity(std_3, &team);
        assert_eq!(proj.weekly_shifts_count, 21);
        assert_eq!(proj.required_weekly_hours, 168.0);
        assert_eq!(proj.team_weekly_capacity_hours, 180.0);
        assert_eq!(proj.deficit_or_surplus_hours, 12.0);
        assert!(proj.sustainable);
    }
}
