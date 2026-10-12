import type { en } from "./en";

type TranslationSchema = {
  [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => unknown ? (...args: A) => string : string;
};

export const ko: TranslationSchema = {
  saved: "테마가 저장되었습니다.",
  exported: "테마 파일을 내보냈습니다.",
  imported: "테마를 불러왔습니다.",
  resetDone: "기본 테마로 되돌렸습니다.",
  title: "커스텀 테마와 폰트",
  import: "가져오기",
  export: "내보내기",
  reset: "초기화",
  save: "테마 저장",
  selectTheme: "테마",
  builtin: "기본 테마",
  custom: "사용자 테마",
  themeNamePlaceholder: "테마 이름...",
  colorGroups: "컬러 그룹",
  background: "배경",
  textColor: "글자",
  baseAndContent: "배경과 글자",
  contentText: "기본 글자",
  panel100: "패널 (100)",
  app200: "앱 (200)",
  border300: "구분선 (300)",
  typography: "타이포그래피와 폰트",
  bundledFonts: "앱에 포함된 폰트",
  systemFonts: "설치된 폰트",
  fontSearch: "폰트 이름 검색...",
  baseFontSize: "기본 글자 크기",
  lineHeight: "줄 간격",
  livePreview: "실시간 미리보기",
  livePreviewTitle: "실시간 테마 미리보기",
  livePreviewBody: "프록시, 도메인 상태, 트래픽 캡처, 테마를 한 화면에서 조정할 수 있습니다.",
};
