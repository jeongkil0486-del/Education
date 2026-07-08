/**
 * TAS WT — 시스템 설정 (슈퍼관리자 전용)
 * js/views/admin/settings.js
 */

import { toast } from "../../../utils/toast.js";

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">시스템 설정</div>
        <div class="section-subtitle">플랫폼 전역 설정을 관리합니다</div>
      </div>
    </div>

    <!-- 섹션: 플랫폼 정보 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__header">
        <div class="card__title">플랫폼 정보</div>
      </div>
      <div class="card__body">
        <div class="info-row">
          <span class="info-row__label">시스템 명</span>
          <span class="info-row__value">TAS Web Training</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">버전</span>
          <span class="info-row__value">v1.0.0</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">인증 방식</span>
          <span class="info-row__value">사번 로그인 (Firebase Authentication)</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">계정 도메인</span>
          <span class="info-row__value" style="font-family:var(--font-mono)">@tas.local</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">DB</span>
          <span class="info-row__value">Firebase Realtime Database</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">파일 저장소</span>
          <span class="info-row__value">Cloudflare R2</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">배포</span>
          <span class="info-row__value">Vercel</span>
        </div>
      </div>
    </div>

    <!-- 섹션: 알림 설정 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__header">
        <div class="card__title">알림 설정</div>
        <div class="card__subtitle">수료기한 임박 알림 기준일을 설정합니다</div>
      </div>
      <div class="card__body">
        <div class="form-group" style="max-width:320px">
          <label class="form-label">수료기한 임박 알림 (일 전)</label>
          <input class="form-control" type="number" id="s-notify-days"
            min="1" max="30" value="3"/>
          <div class="form-hint">직원 로그인 시 남은 기간이 N일 이하이면 알림을 표시합니다.</div>
        </div>
        <div class="form-group" style="max-width:320px;margin-top:var(--space-4)">
          <label class="form-label">기한 초과 알림 표시</label>
          <label class="check-group">
            <input type="checkbox" id="s-show-overdue" checked/>
            <span class="check-group__label">기한 초과 시 배너 표시</span>
          </label>
        </div>
      </div>
      <div class="card__footer">
        <button class="btn btn--primary btn--sm" id="btn-save-notify">저장</button>
      </div>
    </div>

    <!-- 섹션: 데이터 관리 -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card__header">
        <div class="card__title">데이터 관리</div>
        <div class="card__subtitle">주의: 아래 작업은 되돌릴 수 없습니다</div>
      </div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:var(--space-4);border:var(--border-thin);border-radius:var(--radius-md)">
          <div>
            <div style="font-size:var(--text-sm);font-weight:var(--weight-medium)">
              전체 데이터 내보내기 (JSON)
            </div>
            <div class="form-hint" style="margin-top:2px">
              Firebase Console → Realtime Database → 데이터 내보내기를 이용하세요.
            </div>
          </div>
          <button class="btn btn--secondary btn--sm" id="btn-export-data">내보내기 안내</button>
        </div>
      </div>
    </div>

    <!-- 섹션: 개발자 정보 -->
    <div class="card">
      <div class="card__header">
        <div class="card__title">개발 환경</div>
      </div>
      <div class="card__body">
        <div class="info-row">
          <span class="info-row__label">Firebase SDK</span>
          <span class="info-row__value mono">10.12.0</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">모듈 방식</span>
          <span class="info-row__value">ES Modules (import/export)</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">CSS 방식</span>
          <span class="info-row__value">CSS Custom Properties (토큰 기반)</span>
        </div>
        <div class="info-row">
          <span class="info-row__label">라우팅</span>
          <span class="info-row__value">Hash-based SPA (#/dashboard 등)</span>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-save-notify")?.addEventListener("click", () => {
    // TODO: Firebase에 설정값 저장
    toast.success("설정이 저장되었습니다.");
  });

  document.getElementById("btn-export-data")?.addEventListener("click", () => {
    modal_info(
      "데이터 내보내기",
      "Firebase Console → Realtime Database → 우측 메뉴(⋮) → 'JSON 내보내기'를 이용하세요."
    );
  });
}

function modal_info(title, msg) {
  // 간단 알림 — 모달 모듈 없이 alert 사용
  alert(`[${title}]\n\n${msg}`);
}
