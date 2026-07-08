/**
 * TAS WT — 회사 관리 (슈퍼관리자 전용)
 * js/views/admin/companies.js
 */

import { companiesDB } from "../../../core/db.js";
import { modal }       from "../../../utils/modal.js";
import { toast }       from "../../../utils/toast.js";
import { formatDate }  from "../../../utils/date.js";

export async function render(container) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">회사 관리</div>
        <div class="section-subtitle">시스템에 등록된 회사를 관리합니다</div>
      </div>
      <button class="btn btn--primary" id="btn-add-company">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        회사 등록
      </button>
    </div>
    <div class="table-wrap" id="company-table-wrap">
      <div style="display:flex;align-items:center;justify-content:center;padding:var(--space-12)">
        <div class="splash__spinner"
          style="border-color:var(--gray-200);border-top-color:var(--brand-400)"></div>
      </div>
    </div>
  `;

  document.getElementById("btn-add-company")
    ?.addEventListener("click", () => openForm());

  await loadList();
}

let _list = [];

async function loadList() {
  try {
    _list = await companiesDB.list();
  } catch (err) {
    console.warn("[companies] load failed:", err?.message);
    _list = [];
  }
  renderTable();
}

function renderTable() {
  const wrap = document.getElementById("company-table-wrap");
  if (!wrap) return;

  if (!_list.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:var(--space-16)">
        <div class="empty-state__title">등록된 회사가 없습니다</div>
        <div>회사 등록 버튼으로 첫 번째 회사를 추가하세요.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>회사명</th>
          <th>사업자번호</th>
          <th>대표자</th>
          <th>연락처</th>
          <th>등록일</th>
          <th style="width:80px"></th>
        </tr>
      </thead>
      <tbody>
        ${_list.map(c => `
          <tr>
            <td style="font-weight:var(--weight-medium);color:var(--gray-800)">${esc(c.name)}</td>
            <td class="cell--mono">${esc(c.bizNo ?? "–")}</td>
            <td>${esc(c.ceoName ?? "–")}</td>
            <td>${esc(c.phone ?? "–")}</td>
            <td>${formatDate(c.createdAt)}</td>
            <td class="cell--actions">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn btn--ghost btn--sm btn-edit" data-id="${c.id}" title="수정">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2l3 3-7 7H2V9l7-7z"
                      stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="btn btn--ghost btn--sm btn-delete"
                  data-id="${c.id}" title="삭제" style="color:var(--color-danger)">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3h10M5 3V2h4v1M4 3v8a1 1 0 001 1h4a1 1 0 001-1V3"
                      stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll(".btn-edit").forEach(btn =>
    btn.addEventListener("click", () => {
      const item = _list.find(c => c.id === btn.dataset.id);
      if (item) openForm(item);
    })
  );
  wrap.querySelectorAll(".btn-delete").forEach(btn =>
    btn.addEventListener("click", () => confirmDelete(btn.dataset.id))
  );
}

function openForm(item = null) {
  const isEdit = !!item;
  modal.open({
    title: isEdit ? "회사 수정" : "회사 등록",
    size: "md",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label form-label--required">회사명</label>
          <input class="form-control" id="f-name" type="text"
            value="${esc(item?.name ?? "")}" placeholder="예) (주)TAS"/>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">사업자번호</label>
            <input class="form-control" id="f-bizno" type="text"
              value="${esc(item?.bizNo ?? "")}" placeholder="000-00-00000"/>
          </div>
          <div class="form-group">
            <label class="form-label">대표자</label>
            <input class="form-control" id="f-ceo" type="text"
              value="${esc(item?.ceoName ?? "")}"/>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">연락처</label>
            <input class="form-control" id="f-phone" type="text"
              value="${esc(item?.phone ?? "")}" placeholder="02-0000-0000"/>
          </div>
          <div class="form-group">
            <label class="form-label">주소</label>
            <input class="form-control" id="f-address" type="text"
              value="${esc(item?.address ?? "")}"/>
          </div>
        </div>
      </div>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: isEdit ? "저장" : "등록", variant: "primary",
        onClick: () => submitForm(item?.id ?? null) },
    ],
  });
}

async function submitForm(existingId) {
  const name    = document.getElementById("f-name")?.value?.trim();
  const bizNo   = document.getElementById("f-bizno")?.value?.trim();
  const ceoName = document.getElementById("f-ceo")?.value?.trim();
  const phone   = document.getElementById("f-phone")?.value?.trim();
  const address = document.getElementById("f-address")?.value?.trim();

  if (!name) { toast.error("회사명을 입력하세요."); return; }

  const label = existingId ? "저장" : "등록";
  modal.setLoading(label, true);
  try {
    const data = { name, bizNo, ceoName, phone, address };
    if (existingId) {
      await companiesDB.update(existingId, data);
      toast.success("수정되었습니다.");
    } else {
      await companiesDB.create(data);
      toast.success("등록되었습니다.");
    }
    modal.close();
    await loadList();
  } catch (err) {
    toast.error("저장 중 오류가 발생했습니다.");
    console.error(err);
    modal.setLoading(label, false);
  }
}

function confirmDelete(id) {
  const item = _list.find(c => c.id === id);
  modal.open({
    title: "회사 삭제",
    size: "sm",
    body: `<p style="font-size:var(--text-sm);color:var(--gray-600)">
      <strong>"${esc(item?.name ?? "이 회사")}"</strong>를 삭제하시겠습니까?<br/>
      관련 지점·계정 데이터도 함께 삭제됩니다.
    </p>`,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: "삭제", variant: "danger", onClick: async () => {
        modal.setLoading("삭제", true);
        try {
          await companiesDB.delete(id);
          toast.success("삭제되었습니다.");
          modal.close();
          await loadList();
        } catch {
          toast.error("삭제 중 오류가 발생했습니다.");
          modal.setLoading("삭제", false);
        }
      }},
    ],
  });
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
