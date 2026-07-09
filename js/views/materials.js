/**
 * materials.js — 교육자료 관리
 * HQ_ADMIN / INSTRUCTOR 접근 가능
 * 현재 placeholder — 추후 PDF/PPT/동영상 업로드 기능 제공 예정
 */

export async function render(container) {
  try {
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">교육자료 관리</div>
          <div class="section-subtitle">PDF, PPT, 동영상 등 교육 자료를 업로드하고 관리합니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-6)">
        <div class="card__body" style="padding:var(--space-16);text-align:center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-5)">
            <rect x="8" y="4" width="32" height="42" rx="3" stroke="currentColor" stroke-width="2"/>
            <path d="M28 4v12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 26h16M16 32h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--gray-700);margin-bottom:var(--space-2)">
            교육자료 관리
          </div>
          <div style="font-size:var(--text-sm);color:var(--gray-400);line-height:1.6;max-width:360px;margin:0 auto">
            현재 준비 중입니다.<br>
            추후 PDF · PPT · 동영상 파일 업로드 및 강사별 자료 공유 기능이 제공될 예정입니다.
          </div>
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--gray-50);border-radius:var(--radius-md);display:inline-flex;gap:var(--space-6);font-size:var(--text-xs);color:var(--gray-400)">
            <span>📄 PDF 업로드</span>
            <span>📊 PPT 업로드</span>
            <span>🎬 동영상 업로드</span>
            <span>🔗 URL 등록</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("[materials] render failed", err?.code, err?.message, err);
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">${err?.message ?? "알 수 없는 오류"}</div>
      </div>
    `;
  }
}
