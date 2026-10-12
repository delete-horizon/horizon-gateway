import type { en } from "./en";

type TranslationSchema = {
  [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => unknown ? (...args: A) => string : string;
};

export const ko: TranslationSchema = {
  title: "새 대상 추가",
  subtitle: "하나 이상의 도메인을 입력하여 상태 및 가동 시간 모니터링을 시작하세요.",
  assignGroup: "그룹에 할당",
  noGroupDefault: "그룹 없음 (기본값)",
  groupTip: "팁: 사이드바의 그룹 섹션에서 그룹을 관리할 수 있습니다.",
  importUrls: "URL 가져오기",
  placeholder: "example.com\napi.example.com, www.example.com",
  uploadJson: "JSON 업로드",
  export: "내보내기",
  parseBtn: "파싱 및 추가",
  startMonitor: "모니터링 시작",
  queue: "대기열",
  clear: "비우기",
  importAtRegist: "등록 시 그룹",
  noDomainsInQueue: "대기열에 도메인이 없습니다",
  alertFileSaved: "파일이 성공적으로 저장되었습니다!",
  alertInvalidJson: "잘못된 JSON 파일 형식입니다.",
  skippedMessage: (newOnes: number, skipped: number) => `${newOnes}개 추가, ${skipped}개 이미 등록됨 (제외)`,
  importedMessage: (count: number) => `파일에서 ${count}개의 URL을 가져왔습니다.`,
};
