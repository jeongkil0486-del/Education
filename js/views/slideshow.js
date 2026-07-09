/**
 * slideshow.js — 슬라이드쇼
 * INSTRUCTOR / HQ_ADMIN 접근 가능
 * 현재 placeholder — 추후 강의용 슬라이드 재생 기능 제공 예정
 */

export async function render(container) {
  try {
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">슬라이드쇼</div>
          <div class="section-subtitle">강의 자료를 슬라이드 형식으로 재생합니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-6)">
        <div class="card__body" style="padding:var(--space-16);text-align:center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-5)">
            <rect x="4" y="10" width="48" height="32" rx="3" stroke="currentColor" stroke-width="2"/>
            <path d="M22 22l12 6-12 6V22z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M20 46l4-4m12 4l-4-4m-6 0h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--gray-700);margin-bottom:var(--space-2)">
            슬라이드쇼
          </div>
          <div style="font-size:var(--text-sm);color:var(--gray-400);line-height:1.6;max-width:360px;margin:0 auto">
            현재 준비 중입니다.<br>
            추후 업로드된 교육자료를 슬라이드로 재생하고 강의 모드로 전환하는 기능이 제공될 예정입니다.
          </div>
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--gray-50);border-radius:var(--radius-md);display:inline-flex;gap:var(--space-6);font-size:var(--text-xs);color:var(--gray-400)">
            <span>▶ 슬라이드 재생</span>
            <span>⬛ 전체화면 모드</span>
            <span>⏱ 타이머 기능</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("[slideshow] render failed", err?.code, err?.message, err);
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">${err?.message ?? "알 수 없는 오류"}</div>
      </div>
    `;
  }
}
