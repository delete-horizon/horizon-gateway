use crate::model::api_response::ApiResponse;
use crate::model::inspector::Annotation;
use crate::service::inspector_service::InspectorService;

pub const GET_ANNOTATIONS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_annotations",
    description: "UX 인스펙터 정책(주석) 전체 목록을 조회합니다.",
    payload_example: "{}",
    category: "inspector",
    gui_only: false,
};

pub fn get_annotations_svc(
    service: &InspectorService,
) -> Result<ApiResponse<Vec<Annotation>>, String> {
    let list = service.get_all();
    Ok(ApiResponse {
        message: format!("{}개의 정책 조회 완료", list.len()),
        success: true,
        data: list,
    })
}

#[derive(serde::Deserialize, specta::Type)]
pub struct GetAnnotationPayload {
    pub id: String,
}

pub const GET_ANNOTATION_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_annotation",
    description: "ID로 특정 UX 인스펙터 정책(주석)을 조회합니다.",
    payload_example: r#"{"id": "g-101"}"#,
    category: "inspector",
    gui_only: false,
};

pub fn get_annotation_svc(
    service: &InspectorService,
    payload: GetAnnotationPayload,
) -> Result<ApiResponse<Option<Annotation>>, String> {
    let item = service.get_by_id(&payload.id);
    let success = item.is_some();
    let message = if success {
        "정책 조회 완료".to_string()
    } else {
        format!("ID '{}'에 해당하는 정책을 찾을 수 없습니다.", payload.id)
    };
    Ok(ApiResponse {
        message,
        success,
        data: item,
    })
}

#[derive(serde::Deserialize, specta::Type)]
pub struct DeleteAnnotationPayload {
    pub id: String,
}

pub const ADD_ANNOTATION_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "add_annotation",
    description: "UX 인스펙터 정책(주석)을 추가/업데이트합니다.",
    payload_example: r#"{"role": "Submit Button", "description": "Prevent duplicate clicks with 3s lock", "domain": "example.dev", "url": "https://example.dev/checkout", "locators": [{"strategy": "testid", "value": "submit"}]}"#,
    category: "inspector",
    gui_only: false,
};

pub fn add_annotation_svc(
    service: &InspectorService,
    payload: Annotation,
) -> Result<ApiResponse<Vec<Annotation>>, String> {
    service.add_annotation(payload);
    let list = service.get_all();
    Ok(ApiResponse {
        message: "새로운 UX 정책이 저장되었습니다.".to_string(),
        success: true,
        data: list,
    })
}

#[derive(serde::Deserialize, specta::Type)]
pub struct UpdateAnnotationPayload {
    pub id: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default, rename = "hostPattern")]
    pub host_pattern: Option<String>,
    #[serde(default, rename = "pathPattern")]
    pub path_pattern: Option<String>,
    #[serde(default)]
    pub locators: Option<Vec<crate::model::inspector::AnnotationLocator>>,
    #[serde(default, rename = "lastValidation")]
    pub last_validation: Option<crate::model::inspector::LocatorValidation>,
    /// When true, clears persisted lastValidation.
    #[serde(default, rename = "clearValidation")]
    pub clear_validation: Option<bool>,
}

pub const UPDATE_ANNOTATION_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "update_annotation",
    description: "UX 인스펙터 정책(주석)을 수정합니다.",
    payload_example: r#"{"id": "g-101", "role": "Submit Button", "description": "Updated lock logic"}"#,
    category: "inspector",
    gui_only: false,
};

pub fn update_annotation_svc(
    service: &InspectorService,
    payload: UpdateAnnotationPayload,
) -> Result<ApiResponse<Vec<Annotation>>, String> {
    service.update_annotation(
        payload.id,
        payload.role,
        payload.description,
        payload.domain,
        payload.url,
        payload.host_pattern,
        payload.path_pattern,
        payload.locators,
        payload.last_validation,
        payload.clear_validation.unwrap_or(false),
    );
    let list = service.get_all();
    Ok(ApiResponse {
        message: "정책이 수정되었습니다.".to_string(),
        success: true,
        data: list,
    })
}

pub const DELETE_ANNOTATION_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "delete_annotation",
    description: "UX 인스펙터 정책(주석)을 삭제합니다.",
    payload_example: r#"{"id": "g-101"}"#,
    category: "inspector",
    gui_only: false,
};

pub fn delete_annotation_svc(
    service: &InspectorService,
    payload: DeleteAnnotationPayload,
) -> Result<ApiResponse<Vec<Annotation>>, String> {
    service.delete_annotation(payload.id);
    let list = service.get_all();
    Ok(ApiResponse {
        message: "정책이 삭제되었습니다.".to_string(),
        success: true,
        data: list,
    })
}

#[derive(serde::Deserialize, specta::Type)]
pub struct ImportAnnotationsPayload {
    pub annotations: Vec<Annotation>,
}

pub const IMPORT_ANNOTATIONS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "import_annotations",
    description: "UX 인스펙터 정책 목록을 일괄 임포트합니다.",
    payload_example: r#"{"annotations": [{"role": "Submit Button", "description": "desc", "domain": "example.dev", "url": "https://example.dev/checkout"}]}"#,
    category: "inspector",
    gui_only: false,
};

pub fn import_annotations_svc(
    service: &InspectorService,
    payload: ImportAnnotationsPayload,
) -> Result<ApiResponse<Vec<Annotation>>, String> {
    service.import_annotations(payload.annotations);
    let list = service.get_all();
    Ok(ApiResponse {
        message: "정책들을 성공적으로 가져왔습니다.".to_string(),
        success: true,
        data: list,
    })
}

// ── Injection Domains ──────────────────────────────────────────────────

pub const GET_INJECTION_DOMAINS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_injection_domains",
    description: "UI 인스펙터 스크립트를 주입할 도메인 목록을 조회합니다.",
    payload_example: "{}",
    category: "inspector",
    gui_only: false,
};

pub fn get_injection_domains_svc(
    service: &InspectorService,
) -> Result<ApiResponse<Vec<String>>, String> {
    let list = service.get_injection_domains();
    Ok(ApiResponse {
        message: "인젝션 도메인 목록 조회 완료".to_string(),
        success: true,
        data: list,
    })
}

#[derive(serde::Deserialize, specta::Type)]
pub struct SetInjectionDomainsPayload {
    pub domains: Vec<String>,
}

pub const SET_INJECTION_DOMAINS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "set_injection_domains",
    description: "UI 인스펙터 스크립트를 주입할 도메인 목록을 설정합니다.",
    payload_example: r#"{"domains": ["example.com", "test.com"]}"#,
    category: "inspector",
    gui_only: false,
};

pub fn set_injection_domains_svc(
    service: &InspectorService,
    payload: SetInjectionDomainsPayload,
) -> Result<ApiResponse<Vec<String>>, String> {
    service.set_injection_domains(payload.domains);
    let list = service.get_injection_domains();
    Ok(ApiResponse {
        message: "인젝션 도메인 목록이 저장되었습니다.".to_string(),
        success: true,
        data: list,
    })
}

#[derive(serde::Deserialize, specta::Type)]
pub struct SingleDomainPayload {
    pub domain: String,
}

pub const ADD_INJECTION_DOMAIN_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "add_injection_domain",
    description: "UI 인스펙터 스크립트 주입 도메인을 추가합니다.",
    payload_example: r#"{"domain": "example.dev"}"#,
    category: "inspector",
    gui_only: false,
};

pub fn add_injection_domain_svc(
    service: &InspectorService,
    payload: SingleDomainPayload,
) -> Result<ApiResponse<Vec<String>>, String> {
    let list = service.add_injection_domain(&payload.domain);
    Ok(ApiResponse {
        message: format!("인젝션 도메인 '{}' 추가 완료", payload.domain),
        success: true,
        data: list,
    })
}

pub const REMOVE_INJECTION_DOMAIN_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "remove_injection_domain",
        description: "UI 인스펙터 스크립트 주입 도메인을 제거합니다.",
        payload_example: r#"{"domain": "example.dev"}"#,
        category: "inspector",
        gui_only: false,
    };

pub fn remove_injection_domain_svc(
    service: &InspectorService,
    payload: SingleDomainPayload,
) -> Result<ApiResponse<Vec<String>>, String> {
    let list = service.remove_injection_domain(&payload.domain);
    Ok(ApiResponse {
        message: format!("인젝션 도메인 '{}' 제거 완료", payload.domain),
        success: true,
        data: list,
    })
}
