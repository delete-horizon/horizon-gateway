use hg_avatar::{AvatarKit, AvatarPreview, AvatarStudioCatalog, AvatarStudioPart};
use serde::Deserialize;

use crate::serve::events::publish_event;

pub const AVATAR_DRAFT_EVENT: &str = "avatar-draft";
pub const AVATAR_CATALOG_CHANGED_EVENT: &str = "avatar-catalog-changed";

pub const GET_COMM_AVATAR_CATALOG_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "get_comm_avatar_catalog",
        description: "아바타 파츠 카탈로그를 디스크에서 다시 읽습니다.",
        payload_example: "{}",
        category: "avatar",
        gui_only: false,
    };

pub const RELOAD_COMM_AVATAR_CATALOG_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "reload_comm_avatar_catalog",
        description: "아바타 파츠 카탈로그를 디스크에서 다시 읽습니다.",
        payload_example: "{}",
        category: "avatar",
        gui_only: false,
    };

pub const COMPOSE_COMM_AVATAR_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "compose_comm_avatar",
    description: "아바타 킷을 합성해 RGBA 미리보기를 돌려줍니다.",
    payload_example: "{\"kit\":{\"body\":\"sprite\",\"head\":\"none\",\"outfit\":\"cloak\",\"back\":\"none\",\"held\":\"staff\",\"palette\":\"dusk\"},\"step\":0}",
    category: "avatar",
    gui_only: false,
};

pub const WRITE_COMM_AVATAR_PART_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "write_comm_avatar_part",
    description: "아바타 파츠 JSON을 avatar-parts에 저장하고 열려 있는 제작 창에 알립니다.",
    payload_example: "{\"part\":{\"id\":\"sprite\",\"slot\":\"body\",\"shop\":false,\"ko\":\"스프라이트\",\"en\":\"Sprite\",\"glyphs\":[]}}",
    category: "avatar",
    gui_only: false,
};

pub const PUSH_COMM_AVATAR_DRAFT_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "push_comm_avatar_draft",
    description: "저장하지 않고 열려 있는 아바타 제작 창 미리보기에 초안을 반영합니다.",
    payload_example: "{\"part\":{\"id\":\"sprite\",\"slot\":\"body\",\"shop\":false,\"ko\":\"스프라이트\",\"en\":\"Sprite\",\"glyphs\":[]}}",
    category: "avatar",
    gui_only: false,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposePayload {
    pub kit: AvatarKit,
    #[serde(default)]
    pub step: Option<u8>,
}

#[derive(Deserialize)]
pub struct PartPayload {
    pub part: AvatarStudioPart,
}

pub fn get_comm_avatar_catalog() -> Result<AvatarStudioCatalog, String> {
    hg_avatar::reload_from_disk()
}

pub fn compose_comm_avatar(payload: ComposePayload) -> Result<AvatarPreview, String> {
    Ok(hg_avatar::preview_pngish(
        &payload.kit,
        payload.step.unwrap_or(0),
    ))
}

pub fn write_comm_avatar_part(payload: PartPayload) -> Result<String, String> {
    let path = hg_avatar::write_part(payload.part.clone())?;
    publish_event(AVATAR_CATALOG_CHANGED_EVENT, &payload.part);
    Ok(path)
}

pub fn push_comm_avatar_draft(payload: PartPayload) -> Result<(), String> {
    hg_avatar::validate_part(&payload.part)?;
    publish_event(AVATAR_DRAFT_EVENT, &payload.part);
    Ok(())
}
