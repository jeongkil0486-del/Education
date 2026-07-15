import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { authStore, isPortalRole } from "../core/auth.js";
import { modal } from "../utils/modal.js";
import { toast } from "../utils/toast.js";

const CHANGE_LABEL = "변경";

export function openChangePasswordModal() {
  if (!isPortalRole(authStore.role)) {
    toast.error("비밀번호를 변경할 권한이 없습니다.");
    return;
  }

  modal.open({
    title: "비밀번호 변경",
    size: "sm",
    body: `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        ${passwordField("현재 비밀번호", "change-password-current", "current-password")}
        ${passwordField("새 비밀번호", "change-password-new", "new-password", "최소 6자 이상 입력해 주세요.")}
        ${passwordField("새 비밀번호 확인", "change-password-confirm", "new-password")}
      </div>
    `,
    actions: [
      { label: "취소", variant: "secondary", onClick: () => modal.close() },
      { label: CHANGE_LABEL, variant: "primary", onClick: submitPasswordChange },
    ],
  });

  ["change-password-current", "change-password-new", "change-password-confirm"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitPasswordChange();
    });
  });
}

function passwordField(label, id, autocomplete, hint = "") {
  return `
    <div class="form-group" style="margin:0">
      <label class="form-label form-label--required" for="${id}">${label}</label>
      <input class="form-control" id="${id}" type="password" autocomplete="${autocomplete}" />
      ${hint ? `<div class="form-hint">${hint}</div>` : ""}
    </div>
  `;
}

async function submitPasswordChange() {
  const currentPassword = document.getElementById("change-password-current")?.value ?? "";
  const newPassword = document.getElementById("change-password-new")?.value ?? "";
  const confirmation = document.getElementById("change-password-confirm")?.value ?? "";

  const validationMessage = validatePasswords(currentPassword, newPassword, confirmation);
  if (validationMessage) {
    toast.error(validationMessage);
    return;
  }

  const user = authStore.firebaseUser ?? window.__firebase?.auth?.currentUser;
  if (!user?.email) {
    toast.error("로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
    return;
  }

  modal.setLoading(CHANGE_LABEL, true);
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    modal.close();
    toast.success("비밀번호가 변경되었습니다.");
  } catch (error) {
    console.error("[change-password] failed", error?.code, error?.message);
    toast.error(passwordErrorMessage(error?.code));
    modal.setLoading(CHANGE_LABEL, false);
  }
}

export function validatePasswords(currentPassword, newPassword, confirmation) {
  if (!currentPassword) return "현재 비밀번호를 입력해 주세요.";
  if (!newPassword) return "새 비밀번호를 입력해 주세요.";
  if (newPassword.length < 6) return "비밀번호는 최소 6자 이상이어야 합니다.";
  if (newPassword !== confirmation) return "새 비밀번호가 일치하지 않습니다.";
  if (currentPassword === newPassword) return "현재 비밀번호와 다른 비밀번호를 입력해 주세요.";
  return "";
}

function passwordErrorMessage(code) {
  const messages = {
    "auth/wrong-password": "현재 비밀번호가 올바르지 않습니다.",
    "auth/invalid-credential": "현재 비밀번호가 올바르지 않습니다.",
    "auth/weak-password": "비밀번호는 최소 6자 이상이어야 합니다.",
    "auth/requires-recent-login": "보안을 위해 다시 로그인한 후 시도해 주세요.",
    "auth/user-mismatch": "현재 로그인 계정을 확인할 수 없습니다.",
    "auth/user-not-found": "현재 로그인 계정을 확인할 수 없습니다.",
    "auth/too-many-requests": "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    "auth/network-request-failed": "네트워크 연결을 확인한 후 다시 시도해 주세요.",
  };
  return messages[code] ?? "비밀번호 변경 중 오류가 발생했습니다.";
}
