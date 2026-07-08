/**
 * TAS WT — 회사 관리
 * (stub — 실제 기능은 순차적으로 구현 예정)
 */
export async function render(container, params = {}) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">회사 관리</div>
        <div class="section-subtitle">회사를 등록하고 관리합니다.</div>
      </div>
    </div>
    <div class="card">
      <div class="card__body" style="padding:var(--space-16);text-align:center;color:var(--gray-400)">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style="margin:0 auto var(--space-4)">
          <rect x="4" y="4" width="40" height="40" rx="8" stroke="currentColor" stroke-width="2" opacity=".3"/>
          <path d="M16 24h16M24 16v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div style="font-size:var(--text-base);font-weight:var(--weight-medium);color:var(--gray-500);margin-bottom:var(--space-2)">
          회사 관리
        </div>
        <div style="font-size:var(--text-sm)">곧 제공될 예정입니다.</div>
      </div>
    </div>
  `;
}
