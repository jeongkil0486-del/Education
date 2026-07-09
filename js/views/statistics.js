/**
 * statistics.js — 통계
 * HQ_ADMIN 접근 가능
 * 현재 placeholder — 추후 교육 현황 통계 차트 제공 예정
 */

export async function render(container) {
  try {
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">통계</div>
          <div class="section-subtitle">교육 이수율, 수료 현황 등 운영 통계를 확인합니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-6)">
        <div class="card__body" style="padding:var(--space-16);text-align:center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-5)">
            <rect x="6" y="6" width="44" height="44" rx="3" stroke="currentColor" stroke-width="2"/>
            <path d="M14 38l8-10 8 4 10-14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 42h28" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--gray-700);margin-bottom:var(--space-2)">
            통계
          </div>
          <div style="font-size:var(--text-sm);color:var(--gray-400);line-height:1.6;max-width:360px;margin:0 auto">
            현재 준비 중입니다.<br>
            추후 교육 이수율, 직원별 수료 현황, 기간별 추이 등 통계 차트가 제공될 예정입니다.
          </div>
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--gray-50);border-radius:var(--radius-md);display:inline-flex;gap:var(--space-6);font-size:var(--text-xs);color:var(--gray-400)">
            <span>📊 이수율 차트</span>
            <span>👥 직원별 현황</span>
            <span>📅 기간별 추이</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("[statistics] render failed", err?.code, err?.message, err);
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">${err?.message ?? "알 수 없는 오류"}</div>
      </div>
    `;
  }
}
