/**
 * TAS WT — Login View
 *
 * 로그인 방식: 사번 입력
 * Firebase Authentication 계정 형식: {사번소문자}@tas.local
 * 예) 사번 TASEDU → tasedu@tas.local
 */

import { authStore } from "../core/auth.js";
import { toast }     from "../utils/toast.js";

/** 사번 → Firebase 이메일 변환 (고정 도메인: @tas.local) */
function empNoToEmail(empNo) {
  return `${empNo.trim().toLowerCase()}@tas.local`;
}

export function showLogin(container) {
  container.innerHTML = `
    <div class="login-panel">
      <div class="login-panel__logo">
        <div class="login-panel__logo-mark">TAS</div>
        <div class="login-panel__logo-text">
          <div class="login-panel__logo-name">TAS WT</div>
          <div class="login-panel__logo-sub">Web Training Platform</div>
        </div>
      </div>

      <h1 class="login-panel__heading">로그인</h1>
      <p class="login-panel__subheading">사번과 비밀번호를 입력하세요.</p>

      <div class="login-form" id="login-form">
        <div class="form-group">
          <label class="form-label form-label--required" for="login-empno">사번</label>
          <div class="input-group">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6a5 5 0 0110 0" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input
              class="form-control"
              type="text"
              id="login-empno"
              placeholder="사번 입력 (예: TASEDU)"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label form-label--required" for="login-password">비밀번호</label>
          <div class="input-group">
            <svg class="input-group__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11 7V5a3 3 0 00-6 0v2M4 7h8a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
            <input
              class="form-control"
              type="password"
              id="login-password"
              placeholder="••••••••"
              autocomplete="current-password"
              required
            />
            <button
              class="input-group__suffix"
              id="toggle-pw"
              type="button"
              aria-label="비밀번호 표시"
              style="cursor:pointer;background:none;border:none;color:var(--gray-400)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" id="eye-icon">
                <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.25"/>
                <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.25"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="login-options">
          <label class="check-group">
            <input type="checkbox" id="remember-me" />
            <span class="check-group__label">로그인 상태 유지</span>
          </label>
          <button class="link-btn" type="button" id="btn-forgot-pw">비밀번호 찾기</button>
        </div>

        <div id="login-error" class="form-error hidden" style="margin-top:var(--space-1)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.25"/>
            <path d="M6 4v3M6 8.5v.01" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
          </svg>
          <span id="login-error-text"></span>
        </div>

        <button class="btn btn--primary btn--full btn--lg" id="btn-login" type="button"
          style="margin-top:var(--space-2)">
          로그인
        </button>
      </div>

      <div class="login-panel__footer">
        TAS Web Training &copy; ${new Date().getFullYear()} — v1.0
      </div>
    </div>

    <div class="login-art">
      <div class="login-art__grid"></div>
      <h2 class="login-art__headline">
        효율적인 교육 관리,<br />
        <span>TAS Web Training</span>
      </h2>
      <p class="login-art__sub">
        교육자료 업로드부터 수료 관리, 전자서명, 통계까지<br />
        하나의 플랫폼에서 관리하세요.
      </p>
      <div class="login-art__stats">
        <div class="login-art__stat">
          <div class="login-art__stat-value">500+</div>
          <div class="login-art__stat-label">사용자</div>
        </div>
        <div class="login-art__stat">
          <div class="login-art__stat-value">4</div>
          <div class="login-art__stat-label">권한 레벨</div>
        </div>
        <div class="login-art__stat">
          <div class="login-art__stat-value">PWA</div>
          <div class="login-art__stat-label">모바일 지원</div>
        </div>
      </div>
    </div>
  `;

  // Event: submit on Enter (any input field)
  document.querySelectorAll("#login-empno, #login-password").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") attemptLogin();
    });
  });

  document.getElementById("btn-login")
    ?.addEventListener("click", () => attemptLogin());

  // Toggle password visibility
  document.getElementById("toggle-pw")?.addEventListener("click", () => {
    const pw = document.getElementById("login-password");
    pw.type = pw.type === "password" ? "text" : "password";
  });

  // Forgot password placeholder
  document.getElementById("btn-forgot-pw")?.addEventListener("click", () => {
    toast.info("비밀번호 초기화는 관리자에게 문의하세요.");
  });
}

async function attemptLogin() {
  const rawEmpNo = document.getElementById("login-empno")?.value ?? "";
  const password = document.getElementById("login-password")?.value ?? "";
  const errorEl  = document.getElementById("login-error");
  const errorTxt = document.getElementById("login-error-text");
  const btn      = document.getElementById("btn-login");

  const empNo = rawEmpNo.trim();

  if (!empNo) {
    showError("사번을 입력하세요.", errorEl, errorTxt);
    document.getElementById("login-empno")?.focus();
    return;
  }
  if (!password) {
    showError("비밀번호를 입력하세요.", errorEl, errorTxt);
    document.getElementById("login-password")?.focus();
    return;
  }

  // 사번 → Firebase 이메일 변환 (항상 @tas.local)
  const email = empNoToEmail(empNo);

  btn.classList.add("btn--loading");
  btn.disabled = true;
  errorEl?.classList.add("hidden");

  try {
    await authStore.signIn(email, password);
    // onAuthStateChanged in app.js takes over and renders the app
  } catch (err) {
    btn.classList.remove("btn--loading");
    btn.disabled = false;

    const msg = friendlyError(err.code, empNo);
    showError(msg, errorEl, errorTxt);
  }
}

function showError(msg, errorEl, errorTxt) {
  if (errorEl && errorTxt) {
    errorTxt.textContent = msg;
    errorEl.classList.remove("hidden");
  }
}

function friendlyError(code, empNo = "") {
  const map = {
    "auth/user-not-found":      `등록되지 않은 사번입니다. (${empNo})`,
    "auth/wrong-password":      "비밀번호가 올바르지 않습니다.",
    "auth/invalid-email":       "사번 형식이 올바르지 않습니다.",
    "auth/too-many-requests":   "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
    "auth/user-disabled":       "비활성화된 계정입니다. 관리자에게 문의하세요.",
    "auth/invalid-credential":  "사번 또는 비밀번호가 올바르지 않습니다.",
    "auth/network-request-failed": "네트워크 오류가 발생했습니다. 연결을 확인하세요.",
  };
  return map[code] ?? "로그인 중 오류가 발생했습니다. 다시 시도하세요.";
}
