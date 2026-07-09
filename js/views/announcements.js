/**
 * announcements.js — 공지사항
 * 전체 롤 접근 가능 (router allow: null)
 * 현재 placeholder — 추후 공지사항 등록/조회 기능 제공 예정
 */

export async function render(container) {
  try {
    container.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">공지사항</div>
          <div class="section-subtitle">교육 관련 공지 및 안내사항을 확인합니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-6)">
        <div class="card__body" style="padding:var(--space-16);text-align:center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style="color:var(--gray-300);margin:0 auto var(--space-5)">
            <path d="M9 14a3 3 0 013-3h22a3 3 0 013 3v22a3 3 0 01-3 3H9V14z" stroke="currentColor" stroke-width="2"/>
            <path d="M37 20l8-6v20l-8-6" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M17 20h12M17 26h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M17 39a3 3 0 006 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--gray-700);margin-bottom:var(--space-2)">
            공지사항
          </div>
          <div style="font-size:var(--text-sm);color:var(--gray-400);line-height:1.6;max-width:360px;margin:0 auto">
            현재 준비 중입니다.<br>
            추후 교육 일정 안내, 변경 사항 공지, 중요 메시지 등록 기능이 제공될 예정입니다.
          </div>
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--gray-50);border-radius:var(--radius-md);display:inline-flex;gap:var(--space-6);font-size:var(--text-xs);color:var(--gray-400)">
            <span>📢 공지 등록</span>
            <span>🔔 알림 발송</span>
            <span>📌 중요 공지 고정</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("[announcements] render failed", err?.code, err?.message, err);
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">페이지를 불러올 수 없습니다.</div>
        <div style="font-size:var(--text-xs);color:var(--gray-400);margin-top:var(--space-2)">${err?.message ?? "알 수 없는 오류"}</div>
      </div>
    `;
  }
}
