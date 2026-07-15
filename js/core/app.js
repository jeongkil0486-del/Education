/**
 * TAS Learning Hub — App Bootstrap
 * Entry point: listens to Firebase auth state, routes to correct view.
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { router }   from "./router.js";
import { authStore, isPortalRole } from "./auth.js";
import { initNav }   from "../modules/nav.js";
import { initNotifications } from "../modules/notifications.js";
import { initTopbar } from "../modules/topbar.js";
import { showLogin } from "../views/login.js";
import { toast }     from "../utils/toast.js";

const { auth } = window.__firebase;

export function boot() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    hideSplash();

    if (!firebaseUser) {
      showLoginScreen();
      return;
    }

    try {
      await authStore.loadUser(firebaseUser.uid);
      if (!isPortalRole(authStore.role)) {
        await authStore.signOut();
        toast.error("직원 계정은 로그인 대상이 아닙니다.");
        showLoginScreen();
        return;
      }
      showApp();
      initTopbar();
      initNav();
      initNotifications();
      router.init();
    } catch (err) {
      console.error("[boot] Failed to load user profile", err);
      toast.error("사용자 정보를 불러오지 못했습니다. 다시 로그인하세요.");
      await auth.signOut();
      showLoginScreen();
    }
  });
}

function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("splash--hidden");
  setTimeout(() => splash.remove(), 400);
}

function showLoginScreen() {
  document.getElementById("app-shell")?.classList.add("hidden");
  const loginEl = document.getElementById("view-login");
  loginEl?.classList.remove("hidden");
  showLogin(loginEl);
}

function showApp() {
  document.getElementById("view-login")?.classList.add("hidden");
  document.getElementById("app-shell")?.classList.remove("hidden");
}
