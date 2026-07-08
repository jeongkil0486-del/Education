/**
 * TAS WT — Auth Store
 * Holds the current user's profile and role.
 * All role checks go through this module.
 */

import { signInWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { ref, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const { auth, db } = window.__firebase;

/* ── Role constants ──────────────────────────────────────── */
export const ROLES = Object.freeze({
  SUPER_ADMIN:  "super_admin",   // ① 슈퍼관리자
  HQ_ADMIN:     "hq_admin",      // ② 본사 교육관리자
  INSTRUCTOR:   "instructor",    // ③ 강사
  EMPLOYEE:     "employee",      // ④ 직원
});

/* ── Auth Store ──────────────────────────────────────────── */
class AuthStore {
  #user   = null;   // raw Firebase user
  #profile = null;  // profile from DB  { uid, name, role, companyId, branchId, ... }

  /** Load profile from DB after Firebase auth succeeds */
  async loadUser(uid) {
    this.#user = auth.currentUser;
    const snap = await get(ref(db, `users/${uid}`));
    if (!snap.exists()) throw new Error("Profile not found");
    this.#profile = { uid, ...snap.val() };
    return this.#profile;
  }

  /** Current profile (throws if not loaded) */
  get profile() {
    if (!this.#profile) throw new Error("User not loaded");
    return this.#profile;
  }

  /** Current Firebase user */
  get firebaseUser() { return this.#user; }

  /** Role shortcut */
  get role()      { return this.#profile?.role ?? null; }
  get uid()       { return this.#profile?.uid ?? null; }
  get name()      { return this.#profile?.name ?? "–"; }
  get companyId() { return this.#profile?.companyId ?? null; }
  get branchId()  { return this.#profile?.branchId ?? null; }
  get initials()  {
    return (this.#profile?.name ?? "–")
      .split(" ").slice(0, 2)
      .map(w => w[0]).join("").toUpperCase();
  }

  /* ── Permission helpers ────────────────────────────────── */
  isSuperAdmin()  { return this.role === ROLES.SUPER_ADMIN; }
  isHQAdmin()     { return this.role === ROLES.HQ_ADMIN; }
  isInstructor()  { return this.role === ROLES.INSTRUCTOR; }
  isEmployee()    { return this.role === ROLES.EMPLOYEE; }
  isAnyAdmin()    { return this.isSuperAdmin() || this.isHQAdmin(); }

  canManageTrainings()   { return this.isHQAdmin(); }
  canManageAccounts()    { return this.isSuperAdmin(); }
  canViewStatistics()    { return this.isHQAdmin() || this.isSuperAdmin(); }
  canRunSlideshow()      { return this.isInstructor() || this.isHQAdmin(); }
  canCompleteTraining()  { return this.isEmployee(); }

  /* ── Sign in / out ─────────────────────────────────────── */
  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await this.loadUser(cred.user.uid);
    return this.#profile;
  }

  async signOut() {
    this.#user    = null;
    this.#profile = null;
    await signOut(auth);
  }

  /** Clear local state (called on logout before auth signOut) */
  clear() {
    this.#user    = null;
    this.#profile = null;
  }
}

export const authStore = new AuthStore();
