/**
 * TAS WT — Database Service
 * 모든 Firebase CRUD는 여기서만 처리.
 * 저장 경로와 조회 경로를 이 파일에서 일원화.
 *
 * 경로 규칙:
 *   /users/{uid}
 *   /companies/{id}
 *   /branches/{id}          ← companyId 필드로 연결
 *   /departments/{id}
 *   /trainings/{id}
 *   /trainingAssignments/{trainingId}/{uid}
 *   /userAssignments/{uid}/{trainingId}
 *   /trainingCompletions/{trainingId}/{uid}
 *   /userCompletions/{uid}/{trainingId}
 *   /materials/{id}
 *   /templates/{id}
 *   /announcements/{id}
 *   /lessonPlans/{uid}/{trainingId}
 *   /cueCards/{uid}/{trainingId}
 *   /settings/notifications    ← 알림 설정 (HQ Admin이 씀)
 */

import {
  ref, get, set, update, remove, push,
  query, orderByChild, equalTo, limitToLast, onValue, off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const { db } = window.__firebase;

/* ── Helpers ─────────────────────────────────────────────── */
const r = (...segments) => ref(db, segments.join("/"));

async function getVal(path) {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}

/**
 * getList: 경로의 모든 항목을 [{id, ...data}] 배열로 반환.
 * orderBy + equalToVal 모두 있어야 필터 적용.
 * 하나라도 없으면 전체 조회.
 */
async function getList(path, orderBy = null, equalToVal = null) {
  let q = ref(db, path);
  if (orderBy && equalToVal !== null && equalToVal !== undefined) {
    q = query(q, orderByChild(orderBy), equalTo(equalToVal));
  }
  const snap = await get(q);
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, val]) => ({ id, ...val }));
}

async function countAll(path) {
  const snap = await get(ref(db, path));
  return snap.exists() ? Object.keys(snap.val()).length : 0;
}

/* ══════════════════════════════════════════════════════════
   Users  /users/{uid}
══════════════════════════════════════════════════════════ */
export const usersDB = {
  get:     (uid)       => getVal(`users/${uid}`),
  create:  (uid, data) => set(r("users", uid), { ...data, createdAt: Date.now() }),
  update:  (uid, data) => update(r("users", uid), data),
  delete:  (uid)       => remove(r("users", uid)),
  /** companyId로 필터링 */
  list:    (companyId) => getList("users", "companyId", companyId),
  listByRole: (role)   => getList("users", "role", role),
  /** 전체 조회 (슈퍼관리자용) */
  listAll: ()          => getList("users"),
  /** 빠른 카운트 */
  count:   ()          => countAll("users"),
};

/* ══════════════════════════════════════════════════════════
   Companies  /companies/{id}
══════════════════════════════════════════════════════════ */
export const companiesDB = {
  get:     (id)        => getVal(`companies/${id}`),
  create:  (data)      => push(r("companies"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("companies", id), data),
  delete:  (id)        => remove(r("companies", id)),
  list:    ()          => getList("companies"),
  count:   ()          => countAll("companies"),
};

/* ══════════════════════════════════════════════════════════
   Branches  /branches/{id}   (companyId 필드로 회사 연결)
══════════════════════════════════════════════════════════ */
export const branchesDB = {
  get:     (id)        => getVal(`branches/${id}`),
  create:  (data)      => push(r("branches"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("branches", id), data),
  delete:  (id)        => remove(r("branches", id)),
  /** 특정 회사 지점만 조회 */
  list:    (companyId) => getList("branches", "companyId", companyId),
  /** 전체 조회 (슈퍼관리자용) */
  listAll: ()          => getList("branches"),
  count:   ()          => countAll("branches"),
};

/* ══════════════════════════════════════════════════════════
   Departments  /departments/{id}
══════════════════════════════════════════════════════════ */
export const departmentsDB = {
  get:     (id)        => getVal(`departments/${id}`),
  create:  (data)      => push(r("departments"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("departments", id), data),
  delete:  (id)        => remove(r("departments", id)),
  list:    (companyId) => getList("departments", "companyId", companyId),
  listAll: ()          => getList("departments"),
};

/* ══════════════════════════════════════════════════════════
   Trainings  /trainings/{id}
══════════════════════════════════════════════════════════ */
export const trainingsDB = {
  get:     (id)        => getVal(`trainings/${id}`),
  create:  (data)      => push(r("trainings"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("trainings", id), { ...data, updatedAt: Date.now() }),
  delete:  (id)        => remove(r("trainings", id)),
  list:    (companyId) => getList("trainings", "companyId", companyId),
  listAll: ()          => getList("trainings"),
};

/* ══════════════════════════════════════════════════════════
   Training Assignments
   저장: /trainingAssignments/{trainingId}/{uid}
   유저별: /userAssignments/{uid}/{trainingId}
══════════════════════════════════════════════════════════ */
export const assignmentsDB = {
  forTraining: (trainingId) => getList(`trainingAssignments/${trainingId}`),

  assign: async (trainingId, userIds, extraData = {}) => {
    const updates = {};
    userIds.forEach(uid => {
      const record = { uid, assignedAt: Date.now(), status: "pending", ...extraData };
      updates[`trainingAssignments/${trainingId}/${uid}`] = record;
      updates[`userAssignments/${uid}/${trainingId}`]     = record;
    });
    return update(ref(db), updates);
  },

  forUser: (uid) => getList(`userAssignments/${uid}`),

  remove: async (trainingId, uid) => {
    const updates = {};
    updates[`trainingAssignments/${trainingId}/${uid}`] = null;
    updates[`userAssignments/${uid}/${trainingId}`]     = null;
    return update(ref(db), updates);
  },
};

/* ══════════════════════════════════════════════════════════
   Training Completions
   저장: /trainingCompletions/{trainingId}/{uid}
          /userCompletions/{uid}/{trainingId}
══════════════════════════════════════════════════════════ */
export const completionsDB = {
  get: (trainingId, uid) => getVal(`trainingCompletions/${trainingId}/${uid}`),

  complete: async (trainingId, uid, data) => {
    const record = { uid, trainingId, completedAt: Date.now(), ...data };
    const updates = {};
    updates[`trainingCompletions/${trainingId}/${uid}`] = record;
    updates[`userCompletions/${uid}/${trainingId}`]     = record;
    return update(ref(db), updates);
  },

  forTraining: (trainingId) => getList(`trainingCompletions/${trainingId}`),
  forUser:     (uid)        => getList(`userCompletions/${uid}`),
};

/* ══════════════════════════════════════════════════════════
   Materials  /materials/{id}
══════════════════════════════════════════════════════════ */
export const materialsDB = {
  get:     (id)        => getVal(`materials/${id}`),
  create:  (data)      => push(r("materials"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("materials", id), data),
  delete:  (id)        => remove(r("materials", id)),
  list:    (companyId) => getList("materials", "companyId", companyId),
  listAll: ()          => getList("materials"),
};

/* ══════════════════════════════════════════════════════════
   Templates  /templates/{id}
══════════════════════════════════════════════════════════ */
export const templatesDB = {
  get:     (id)        => getVal(`templates/${id}`),
  create:  (data)      => push(r("templates"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("templates", id), data),
  delete:  (id)        => remove(r("templates", id)),
  list:    (companyId) => getList("templates", "companyId", companyId),
  listAll: ()          => getList("templates"),
};

/* ══════════════════════════════════════════════════════════
   Announcements  /announcements/{id}
══════════════════════════════════════════════════════════ */
export const announcementsDB = {
  get:     (id)        => getVal(`announcements/${id}`),
  create:  (data)      => push(r("announcements"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("announcements", id), { ...data, updatedAt: Date.now() }),
  delete:  (id)        => remove(r("announcements", id)),
  list:    (companyId) => getList("announcements", "companyId", companyId),
  recent:  async (companyId, n = 5) => {
    const q = query(
      r("announcements"),
      orderByChild("companyId"),
      equalTo(companyId),
      limitToLast(n)
    );
    const snap = await get(q);
    if (!snap.exists()) return [];
    return Object.entries(snap.val()).map(([id, v]) => ({ id, ...v })).reverse();
  },
};

/* ══════════════════════════════════════════════════════════
   Instructor: Lesson Plans & Cue Cards
   /lessonPlans/{uid}/{trainingId}
   /cueCards/{uid}/{trainingId}
══════════════════════════════════════════════════════════ */
export const instructorDB = {
  getLessonPlan:  (uid, tid)       => getVal(`lessonPlans/${uid}/${tid}`),
  saveLessonPlan: (uid, tid, data) => set(r(`lessonPlans/${uid}`, tid), { ...data, updatedAt: Date.now() }),
  getCueCard:     (uid, tid)       => getVal(`cueCards/${uid}/${tid}`),
  saveCueCard:    (uid, tid, data) => set(r(`cueCards/${uid}`, tid), { ...data, updatedAt: Date.now() }),
};

/* ══════════════════════════════════════════════════════════
   Settings  /settings/{key}
   HQ Admin이 읽고 씀. 슈퍼관리자는 시스템 설정 화면에서 조회만.
══════════════════════════════════════════════════════════ */
export const settingsDB = {
  getNotifications: ()       => getVal("settings/notifications"),
  setNotifications: (data)   => set(r("settings", "notifications"), data),
  get:  (key)                => getVal(`settings/${key}`),
  set:  (key, data)          => set(r("settings", key), data),
};

/* ══════════════════════════════════════════════════════════
   Real-time subscriptions (onValue)
══════════════════════════════════════════════════════════ */
export const realtimeDB = {
  subscribe: (path, callback) => {
    const dbRef = ref(db, path);
    const handler = snap => {
      const val = snap.val();
      if (!val) { callback([]); return; }
      const items = Array.isArray(val)
        ? val
        : Object.entries(val).map(([id, v]) => ({ id, ...v }));
      callback(items);
    };
    onValue(dbRef, handler);
    return () => off(dbRef, "value", handler);
  },
};

/* ══════════════════════════════════════════════════════════
   Storage metadata (Cloudflare R2 업로드 후 메타 저장)
══════════════════════════════════════════════════════════ */
export const storageDB = {
  saveMaterialMeta: (companyId, data) =>
    push(r("materials"), {
      companyId,
      title:       data.title,
      description: data.description || "",
      url:         data.url,
      fileType:    data.fileType,
      fileSize:    data.fileSize,
      uploadedBy:  data.uploadedBy,
      createdAt:   Date.now(),
    }),
};
