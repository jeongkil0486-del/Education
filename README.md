# TAS Learning Hub — Training Management Platform

기업용 교육 관리 플랫폼 (LMS)

---

## 프로젝트 구조

```
tas-wt/
│
├── index.html              # 앱 셸 (레이아웃만, 기능 없음)
├── manifest.json           # PWA 매니페스트
├── database.rules.json     # Firebase DB 보안 규칙
│
├── css/
│   ├── tokens.css          # 디자인 토큰 (색상, 타이포, 간격)
│   ├── base.css            # 리셋, 유틸리티, 공통 요소
│   ├── layout.css          # 앱 셸, 사이드바, 탑바, 레이아웃
│   ├── components.css      # 버튼, 폼, 카드, 테이블, 탭
│   └── views.css           # 뷰별 고유 스타일 (로그인, 대시보드 등)
│
└── js/
    ├── core/
    │   ├── app.js          # 부트스트랩 (Firebase 인증 리스너)
    │   ├── auth.js         # 인증 스토어, 역할/권한 관리
    │   ├── router.js       # 해시 기반 SPA 라우터, 역할 가드
    │   └── db.js           # Firebase DB 서비스 레이어 (모든 CRUD)
    │
    ├── modules/
    │   ├── nav.js          # 사이드바 내비게이션 (역할별 메뉴)
    │   ├── topbar.js       # 탑바 (제목, 브레드크럼, 프로필, 로그아웃)
    │   └── notifications.js # 알림 벨, 패널, 알림 배너
    │
    ├── views/
    │   ├── login.js        # 로그인 화면
    │   ├── dashboard.js    # 대시보드 (역할별 자동 렌더링)
    │   ├── trainings.js    # 교육 관리 (HQ Admin)
    │   ├── training-detail.js  # 교육 상세 / 수료 현황
    │   ├── materials.js    # 교육자료 관리
    │   ├── employees.js    # 직원 관리
    │   ├── employee-detail.js  # 직원 상세 / 교육이력
    │   ├── my-trainings.js # 내 교육 (직원/강사)
    │   ├── my-history.js   # 교육 이력 (직원)
    │   ├── statistics.js   # 통계
    │   ├── announcements.js # 공지사항
    │   ├── templates.js    # 교육 템플릿
    │   ├── slideshow.js    # 슬라이드쇼 (강사)
    │   ├── lesson-plan.js  # 교안 작성 (강사)
    │   └── admin/
    │       ├── companies.js  # 회사 관리 (슈퍼관리자)
    │       ├── branches.js   # 지점 관리 (슈퍼관리자)
    │       ├── accounts.js   # 계정 관리 (슈퍼관리자)
    │       └── settings.js   # 시스템 설정 (슈퍼관리자)
    │
    └── utils/
        ├── toast.js        # 토스트 알림
        ├── modal.js        # 모달 유틸리티
        └── date.js         # 날짜 포맷/유틸
```

---

## 권한 구조

| 역할 | 코드 | 담당 |
|------|------|------|
| 슈퍼관리자 | `super_admin` | 회사/지점/계정 관리 |
| 본사 교육관리자 | `hq_admin` | 교육 생성/관리/통계 |
| 강사 | `instructor` | 강의/슬라이드/교안 |
| 직원 | `employee` | 교육 수료/이력 조회 |

---

## 설정 방법

### 1. Firebase 설정

`index.html` 하단의 `firebaseConfig` 값을 실제 Firebase 프로젝트 값으로 교체하세요.

```javascript
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
```

### 2. Firebase DB 보안 규칙 적용

Firebase 콘솔 → Realtime Database → 규칙 탭에
`database.rules.json` 내용을 붙여넣으세요.

### 3. 첫 번째 슈퍼관리자 계정 생성

Firebase 콘솔에서 직접 수행하거나 임시 스크립트를 이용하세요.

Firebase Authentication에 이메일/비밀번호 계정 생성 후,
Realtime Database에 아래 경로로 프로필을 추가하세요.

```json
// /users/{uid}
{
  "name": "관리자 이름",
  "email": "admin@company.com",
  "role": "super_admin",
  "companyId": null,
  "createdAt": 1720000000000
}
```

### 4. Vercel 배포

```bash
# 정적 사이트 그대로 배포 (빌드 단계 없음)
vercel --prod
```

### 5. Cloudflare R2 (교육자료 파일 저장)

Cloud Functions를 통해 R2에 업로드합니다.
`functions/` 폴더에 업로드 함수를 추가하세요.

---

## 확장 예정 기능

- [ ] 온라인 시험 (객관식/주관식/자동 채점)
- [ ] 수료증 PDF 발급
- [ ] 교육 만족도 설문
- [ ] 영상 스트리밍 (Cloudflare Stream)
- [ ] QR 출석 체크
- [ ] 이메일/앱 푸시 알림
- [ ] AI 기반 교육자료 요약 검색

---

## 기술 스택

- **Frontend**: Vanilla JS (ES Modules), CSS Custom Properties
- **Auth**: Firebase Authentication
- **DB**: Firebase Realtime Database
- **Storage**: Cloudflare R2 (파일), Firebase (메타데이터)
- **Functions**: Firebase Cloud Functions
- **Deploy**: Vercel
- **PWA**: Web App Manifest + Service Worker (예정)
