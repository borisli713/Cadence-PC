use serde::{Deserialize, Serialize};
use tauri::State;

use crate::firebase_client::load_embedded_firebase_config;
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    pub app_version: String,
    pub platform: String,
    pub project_id: String,
    pub firestore_database_id: String,
    pub sync_engine: String,
    pub rust_modules_count: usize,
    pub cached_workspace_docs: usize,
}

pub fn build_desktop_runtime_info(cached_workspace_docs: usize) -> Result<DesktopRuntimeInfo, String> {
    let cfg = load_embedded_firebase_config()?;
    Ok(DesktopRuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        project_id: cfg.project_id,
        firestore_database_id: cfg.firestore_database_id,
        sync_engine: "rust-firestore-rest-commit+live-streams".to_string(),
        rust_modules_count: 36,
        cached_workspace_docs,
    })
}

#[tauri::command]
pub fn get_desktop_runtime_info_cmd(
    cache: State<'_, WorkspaceCacheState>,
) -> Result<DesktopRuntimeInfo, String> {
    let docs = cache.current_insights().cached_doc_count;
    build_desktop_runtime_info(docs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_info_exposes_shared_android_web_database() {
        let info = build_desktop_runtime_info(12).expect("runtime info should load");
        assert_eq!(info.project_id, "silken-eye-377716");
        assert_eq!(
            info.firestore_database_id,
            "ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68"
        );
        assert_eq!(info.cached_workspace_docs, 12);
    }
}
