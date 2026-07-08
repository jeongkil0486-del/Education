/**
 * TAS WT — 시스템 설정 (슈퍼관리자 전용)
 * js/views/admin/settings.js
 *
 * 슈퍼관리자는 시스템 정보·환경·권한 구조만 조회.
 * 알림 설정은 본사 교육관리자(HQ Admin) 메뉴에서 관리.
 */

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">시스템 설정</div>
        <div class="section-subtitle">플랫폼 환경 및 권한 구조 정보</div>
      </div>
    </div>

    <!-- 플랫폼 정보 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__header">
        <div class="card__title">플랫폼 정보</div>
      </div>
      <div class="card__body">
        ${row("시스템 명",    "TAS Web Training")}
        ${row("버전",        "v1.0.0")}
        ${row("인증 방식",   "사번 로그인 (Firebase Authentication)")}
        ${row("계정 도메인", '<code style="font-family:var(--font-mono);font-size:var(--text-xs)">@tas.local</code>')}
        ${row("데이터베이스", "Firebase Realtime Database")}
        ${row("파일 저장소", "Cloudflare R2")}
        ${row("배포",        "Vercel")}
      </div>
    </div>

    <!-- 권한 구조 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__header">
        <div class="card__title">권한 구조</div>
        <div class="card__subtitle">역할별 담당 기능 범위</div>
      </div>
      <div class="card__body" style="padding:0">
        <table class="data-table">
          <thead>
            <tr>
              <th>역할</th>
              <th>코드</th>
              <th>주요 권한</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="chip chip--danger">슈퍼관리자</span></td>
              <td class="cell--mono">super_admin</td>
              <td style="font-size:var(--text-xs);color:var(--gray-600)">
                회사·지점 등록, 계정 생성·삭제, 권한 변경, 시스템 설정
              </td>
            </tr>
            <tr>
              <td><span class="chip chip--primary">본사 교육관리자</span></td>
              <td class="cell--mono">hq_admin</td>
              <td style="font-size:var(--text-xs);color:var(--gray-600)">
                교육 생성·관리·통계, 교육자료 업로드, 직원 관리, 알림 설정
              </td>
            </tr>
            <tr>
              <td><span class="chip chip--info">강사</span></td>
              <td class="cell--mono">instructor</td>
              <td style="font-size:var(--text-xs);color:var(--gray-600)">
                배정 교육 조회, 슬라이드쇼, 교안·큐카드 작성
              </td>
            </tr>
            <tr>
              <td><span class="chip chip--neutral">직원</span></td>
              <td class="cell--mono">employee</td>
              <td style="font-size:var(--text-xs);color:var(--gray-600)">
                배정 교육 수료, 전자서명, 교육이력 조회
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 개발 환경 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__header">
        <div class="card__title">개발 환경</div>
      </div>
      <div class="card__body">
        ${row("Firebase SDK",  "10.12.0")}
        ${row("모듈 방식",    "ES Modules (import/export)")}
        ${row("CSS 방식",     "CSS Custom Properties (디자인 토큰)")}
        ${row("라우팅",       "Hash-based SPA (#/dashboard 등)")}
        ${row("PWA",          "Web App Manifest (manifest.json)")}
      </div>
    </div>

    <!-- Firebase DB 경로 참조 -->
    <div class="card">
      <div class="card__header">
        <div class="card__title">Firebase DB 주요 경로</div>
        <div class="card__subtitle">저장·조회 경로 일람 (슈퍼관리자 참조용)</div>
      </div>
      <div class="card__body" style="padding:0">
        <table class="data-table">
          <thead>
            <tr><th>컬렉션</th><th>경로</th><th>필터 기준</th></tr>
          </thead>
          <tbody>
            ${dbRow("사용자",      "/users/{uid}",                           "–")}
            ${dbRow("회사",        "/companies/{id}",                        "–")}
            ${dbRow("지점",        "/branches/{id}",                         "companyId")}
            ${dbRow("부서",        "/departments/{id}",                      "companyId")}
            ${dbRow("교육",        "/trainings/{id}",                        "companyId")}
            ${dbRow("교육 배정",   "/trainingAssignments/{trainingId}/{uid}", "–")}
            ${dbRow("유저 배정",   "/userAssignments/{uid}/{trainingId}",     "–")}
            ${dbRow("수료 기록",   "/trainingCompletions/{trainingId}/{uid}", "–")}
            ${dbRow("교육자료",    "/materials/{id}",                        "companyId")}
            ${dbRow("공지사항",    "/announcements/{id}",                    "companyId")}
            ${dbRow("알림 설정",   "/settings/notifications",                "–")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function row(label, value) {
  return `
    <div class="info-row">
      <span class="info-row__label">${label}</span>
      <span class="info-row__value">${value}</span>
    </div>`;
}

function dbRow(name, path, filter) {
  return `
    <tr>
      <td style="font-size:var(--text-sm)">${name}</td>
      <td class="cell--mono" style="font-size:var(--text-xs)">${path}</td>
      <td style="font-size:var(--text-xs);color:var(--gray-400)">${filter}</td>
    </tr>`;
}
