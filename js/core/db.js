/**
 * TAS WT — Database Service
 * Centralised Firebase Realtime Database operations.
 * All CRUD for every collection lives here.
 * Views/modules should NOT import firebase-database directly.
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

async function getList(path, orderBy = null, equalToVal = null) {
  let q = ref(db, path);
  if (orderBy) q = query(q, orderByChild(orderBy));
  if (equalToVal !== null) q = query(q, equalTo(equalToVal));
  const snap = await get(q);
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, val]) => ({ id, ...val }));
}

/* ── Users ───────────────────────────────────────────────── */
export const usersDB = {
  get:    (uid)         => getVal(`users/${uid}`),
  create: (uid, data)   => set(r("users", uid), { ...data, createdAt: Date.now() }),
  update: (uid, data)   => update(r("users", uid), data),
  delete: (uid)         => remove(r("users", uid)),
  list:   (companyId)   => getList("users", "companyId", companyId),
  listAll: ()           => getList("users"),
};

/* ── Companies ───────────────────────────────────────────── */
export const companiesDB = {
  get:    (id)          => getVal(`companies/${id}`),
  create: (data)        => push(r("companies"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("companies", id), data),
  delete: (id)          => remove(r("companies", id)),
  list:   ()            => getList("companies"),
};

/* ── Branches (지점) ─────────────────────────────────────── */
export const branchesDB = {
  get:    (id)          => getVal(`branches/${id}`),
  create: (data)        => push(r("branches"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("branches", id), data),
  delete: (id)          => remove(r("branches", id)),
  list:   (companyId)   => getList("branches", "companyId", companyId),
};

/* ── Departments ─────────────────────────────────────────── */
export const departmentsDB = {
  get:    (id)          => getVal(`departments/${id}`),
  create: (data)        => push(r("departments"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("departments", id), data),
  delete: (id)          => remove(r("departments", id)),
  list:   (companyId)   => getList("departments", "companyId", companyId),
};

/* ── Trainings (교육) ────────────────────────────────────── */
export const trainingsDB = {
  get:    (id)          => getVal(`trainings/${id}`),
  create: (data)        => push(r("trainings"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("trainings", id), { ...data, updatedAt: Date.now() }),
  delete: (id)          => remove(r("trainings", id)),
  list:   (companyId)   => getList("trainings", "companyId", companyId),
  listAll: ()           => getList("trainings"),
};

/* ── Training Assignments ────────────────────────────────── */
export const assignmentsDB = {
  get:    (trainingId)  => getList(`trainingAssignments/${trainingId}`),

  /** Assign users to a training */
  assign: async (trainingId, userIds) => {
    const updates = {};
    userIds.forEach(uid => {
      updates[`trainingAssignments/${trainingId}/${uid}`] = {
        uid,
        assignedAt: Date.now(),
        status: "pending",
      };
    });
    return update(ref(db), updates);
  },

  /** Get all assignments for a user */
  forUser: (uid) => getList(`userAssignments/${uid}`),

  /** Remove an assignment */
  remove: (trainingId, uid) => remove(r(`trainingAssignments/${trainingId}`, uid)),
};

/* ── Training Completions ────────────────────────────────── */
export const completionsDB = {
  get:    (trainingId, uid) => getVal(`trainingCompletions/${trainingId}/${uid}`),

  /** Record a completion */
  complete: (trainingId, uid, data) =>
    set(r(`trainingCompletions/${trainingId}`, uid), {
      uid,
      trainingId,
      completedAt: Date.now(),
      ...data,
    }),

  /** All completions for a training */
  forTraining: (trainingId) => getList(`trainingCompletions/${trainingId}`),

  /** All completions for a user */
  forUser: (uid) => getList(`userCompletions/${uid}`),
};

/* ── Materials (교육자료) ─────────────────────────────────── */
export const materialsDB = {
  get:    (id)          => getVal(`materials/${id}`),
  create: (data)        => push(r("materials"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("materials", id), data),
  delete: (id)          => remove(r("materials", id)),
  list:   (companyId)   => getList("materials", "companyId", companyId),
};

/* ── Templates (교육 템플릿) ─────────────────────────────── */
export const templatesDB = {
  get:    (id)          => getVal(`templates/${id}`),
  create: (data)        => push(r("templates"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("templates", id), data),
  delete: (id)          => remove(r("templates", id)),
  list:   (companyId)   => getList("templates", "companyId", companyId),
};

/* ── Announcements (공지사항) ────────────────────────────── */
export const announcementsDB = {
  get:    (id)          => getVal(`announcements/${id}`),
  create: (data)        => push(r("announcements"), { ...data, createdAt: Date.now() }),
  update: (id, data)    => update(r("announcements", id), { ...data, updatedAt: Date.now() }),
  delete: (id)          => remove(r("announcements", id)),
  list:   (companyId)   => getList("announcements", "companyId", companyId),
  recent: async (companyId, n = 5) => {
    const q = query(r("announcements"), orderByChild("companyId"), equalTo(companyId), limitToLast(n));
    const snap = await get(q);
    if (!snap.exists()) return [];
    return Object.entries(snap.val()).map(([id, v]) => ({ id, ...v })).reverse();
  }
};

/* ── Lesson Plans & Cue Cards (강사 전용) ────────────────── */
export const instructorDB = {
  getLessonPlan: (uid, trainingId) => getVal(`lessonPlans/${uid}/${trainingId}`),
  saveLessonPlan: (uid, trainingId, data) =>
    set(r(`lessonPlans/${uid}`, trainingId), { ...data, updatedAt: Date.now() }),

  getCueCard: (uid, trainingId) => getVal(`cueCards/${uid}/${trainingId}`),
  saveCueCard: (uid, trainingId, data) =>
    set(r(`cueCards/${uid}`, trainingId), { ...data, updatedAt: Date.now() }),
};

/* ── Real-time subscriptions ─────────────────────────────── */
export const realtimeDB = {
  /**
   * Subscribe to a path, returns unsubscribe fn.
   * @param {string} path
   * @param {function} callback - called with array of items
   */
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
  }
};

/* ── Storage (Cloudflare R2) ─────────────────────────────── */
// R2 uploads go through Cloud Functions, not direct SDK.
// This is just the metadata layer that saves to Firebase.
export const storageDB = {
  /** After Cloud Function uploads file to R2, save metadata to Firebase */
  saveMaterialMeta: (companyId, data) =>
    push(r("materials"), {
      companyId,
      title:       data.title,
      description: data.description || "",
      url:         data.url,        // R2 public URL
      fileType:    data.fileType,   // pdf | ppt | image | video
      fileSize:    data.fileSize,
      uploadedBy:  data.uploadedBy,
      createdAt:   Date.now(),
    }),
};
