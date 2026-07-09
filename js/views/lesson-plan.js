/**
 * lesson-plan.js — 교안 작성
 * INSTRUCTOR 접근 가능
 * 현재 placeholder — 추후 교안 편집기 기능 제공 예정
 */

export async function render(container) {
  try {
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">교안 작성</div>
          <div class="section-subtitle">교육 진행에 필요한 교안을 작성하고 관리합니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-6)">
        <div class="card__body" style="padding:var(--space-16);text-align:center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-5)">
            <path d="M10 46L14 32l24-24 10 10-24 24-14 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M38 8l10 10M14 32l10 10" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--gray-700);margin-bottom:var(--space-2)">
            교안 작성
          </div>
          <div style="font-size:var(--text-sm);color:var(--gray-400);line-height:1.6;max-width:360px;margin:0 auto">
            현재 준비 중입니다.<br>
            추후 교육별 교안 작성, 목차 구성, 메모 기능이 제공될 예정입니다.
          </div>
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--gray-50);border-radius:var(--radius-md);display:inline-flex;gap:var(--space-6);font-size:var(--text-xs);color:var(--gray-400)">
            <span>✏️ 교안 편집</span>
            <span>📑 목차 구성</span>
            <span>💾 자동 저장</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("[lesson-plan] render failed", err?.code, err?.message, err);
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">${err?.message ?? "알 수 없는 오류"}</div>
      </div>
    `;
  }
}
