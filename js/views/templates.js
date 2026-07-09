/**
 * templates.js — 교육 템플릿 관리
 * HQ_ADMIN 접근 가능
 * 현재 placeholder — 추후 이력카드 템플릿 업로드/관리 기능 제공 예정
 */

export async function render(container) {
  try {
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">교육 템플릿</div>
          <div class="section-subtitle">이력카드 양식 등 교육 관련 템플릿을 관리합니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-6)">
        <div class="card__body" style="padding:var(--space-16);text-align:center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-5)">
            <rect x="6" y="6" width="44" height="44" rx="4" stroke="currentColor" stroke-width="2"/>
            <path d="M14 18h28M14 26h18M14 34h22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <rect x="34" y="30" width="12" height="12" rx="2" fill="currentColor" opacity=".15"/>
          </svg>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--gray-700);margin-bottom:var(--space-2)">
            교육 템플릿
          </div>
          <div style="font-size:var(--text-sm);color:var(--gray-400);line-height:1.6;max-width:360px;margin:0 auto">
            현재 준비 중입니다.<br>
            추후 이력카드 양식 업로드, 템플릿 미리보기 및 적용 기능이 제공될 예정입니다.
          </div>
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--gray-50);border-radius:var(--radius-md);display:inline-flex;gap:var(--space-6);font-size:var(--text-xs);color:var(--gray-400)">
            <span>📋 이력카드 양식</span>
            <span>🖨️ 인쇄 템플릿</span>
            <span>🔖 서명 양식</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("[templates] render failed", err?.code, err?.message, err);
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">${err?.message ?? "알 수 없는 오류"}</div>
      </div>
    `;
  }
}
