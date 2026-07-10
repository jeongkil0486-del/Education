/**
 * TAS WT — Database Service
 * 모든 Firebase CRUD는 여기서만 처리.
 * 저장 경로와 조회 경로를 이 파일에서 일원화.
 *
 * 경로 규칙 (기존):
 *   /users/{uid}
 *   /companies/{id}
 *   /branches/{id}          ← companyId 필드로 연결
 *   /departments/{id}
 *   /trainings/{id}                           ← 기존 교육 (계속 유지)
 *   /trainingAssignments/{trainingId}/{uid}
 *   /userAssignments/{uid}/{trainingId}
 *   /trainingCompletions/{trainingId}/{uid}
 *   /userCompletions/{uid}/{trainingId}
 *   /materials/{id}
 *   /templates/{id}
 *   /announcements/{id}
 *   /lessonPlans/{uid}/{trainingId}
 *   /cueCards/{uid}/{trainingId}
 *   /settings/notifications
 *
 * 신규 경로 (교육 항목/회차 구조):
 *   /trainingItems/{itemId}                   ← 교육 항목(템플릿)
 *   /trainingSessions/{sessionId}             ← 교육 회차(실시)
 *   /sessionAssignments/{sessionId}/{uid}     ← 회차별 배정
 *   /userSessionAssignments/{uid}/{sessionId} ← 유저별 회차 배정
 *   /sessionCompletions/{sessionId}/{uid}     ← 회차별 수료
 *   /userSessionCompletions/{uid}/{sessionId} ← 유저별 회차 수료
 *
 * 설계 원칙:
 *   - 기존 /trainings 경로는 그대로 유지 (기존 기능 영향 없음)
 *   - 신규 구조는 별도 경로로 완전 분리
 *   - 회차(session)가 완료됐을 때만 직원 교육이력에 PASS 기록 생성
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
  list:    (companyId) => getList("users", "companyId", companyId),
  listByRole: (role)   => getList("users", "role", role),
  listAll: ()          => getList("users"),
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
   Branches  /branches/{id}
══════════════════════════════════════════════════════════ */
export const branchesDB = {
  get:     (id)        => getVal(`branches/${id}`),
  create:  (data)      => push(r("branches"), { ...data, createdAt: Date.now() }),
  update:  (id, data)  => update(r("branches", id), data),
  delete:  (id)        => remove(r("branches", id)),
  list:    (companyId) => getList("branches", "companyId", companyId),
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
   Trainings  /trainings/{id}   ← 기존 구조 완전 유지
══════════════════════════════════════════════════════════ */
export const trainingsDB = {
  get:     (id)        => getVal(`trainings/${id}`),
  create:  (data)      => {
    const now = Date.now();
    return push(r("trainings"), { ...data, createdAt: data.createdAt ?? now, updatedAt: now });
  },
  update:  (id, data)  => update(r("trainings", id), { ...data, updatedAt: Date.now() }),
  close:   (id, data = {}) => update(r("trainings", id), {
    ...data,
    status: "closed",
    closedAt: Date.now(),
    updatedAt: Date.now(),
  }),
  complete: (id, data = {}) => update(r("trainings", id), {
    ...data,
    status: "completed",
    completedAt: Date.now(),
    updatedAt: Date.now(),
  }),
  delete:  (id)        => remove(r("trainings", id)),
  list:    (companyId) => getList("trainings", "companyId", companyId),
  listAll: ()          => getList("trainings"),
  deleteCascade: async (id) => {
    const [assignments, completions] = await Promise.all([
      getList(`trainingAssignments/${id}`),
      getList(`trainingCompletions/${id}`),
    ]);
    const updates = { [`trainings/${id}`]: null };
    assignments.forEach(({ uid }) => {
      updates[`trainingAssignments/${id}/${uid}`] = null;
      updates[`userAssignments/${uid}/${id}`] = null;
    });
    completions.forEach(({ uid }) => {
      updates[`trainingCompletions/${id}/${uid}`] = null;
      updates[`userCompletions/${uid}/${id}`] = null;
    });
    return update(ref(db), updates);
  },
};

/* ══════════════════════════════════════════════════════════
   Training Assignments (기존)
   /trainingAssignments/{trainingId}/{uid}
   /userAssignments/{uid}/{trainingId}
══════════════════════════════════════════════════════════ */
export const assignmentsDB = {
  forTraining: (trainingId) => getList(`trainingAssignments/${trainingId}`),

  assign: async (trainingId, userIds, extraData = {}) => {
    const updates = {};
    userIds.forEach(uid => {
      const record = {
        uid,
        trainingId,
        assignedAt: extraData.assignedAt ?? Date.now(),
        assignedBy: extraData.assignedBy ?? "",
        status: extraData.status ?? "pending",
        trainingTitle: extraData.trainingTitle ?? "",
        deadline: extraData.deadline ?? null,
        ...extraData,
      };
      updates[`trainingAssignments/${trainingId}/${uid}`] = record;
      updates[`userAssignments/${uid}/${trainingId}`]     = record;
    });
    return update(ref(db), updates);
  },

  assignUsers: async (trainingId, users, extraData = {}) => {
    const updates = {};
    const assignedAt = extraData.assignedAt ?? Date.now();
    users.forEach((user) => {
      const uid = user.uid ?? user.id;
      if (!uid) return;
      const record = {
        uid,
        trainingId,
        assignedAt,
        assignedBy: extraData.assignedBy ?? "",
        status: extraData.status ?? "pending",
        trainingTitle: extraData.trainingTitle ?? "",
        deadline: extraData.deadline ?? null,
        employeeName: user.name ?? "",
        empNo: user.empNo ?? "",
        branchId: user.branchId ?? "",
        branchName: user.branchName ?? "",
        branchCode: user.branchCode ?? "",
        companyId: user.companyId ?? "",
        companyName: user.companyName ?? "",
        ...extraData,
      };
      updates[`trainingAssignments/${trainingId}/${uid}`] = record;
      updates[`userAssignments/${uid}/${trainingId}`] = record;
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
   Training Completions (기존)
   /trainingCompletions/{trainingId}/{uid}
   /userCompletions/{uid}/{trainingId}
══════════════════════════════════════════════════════════ */
export const completionsDB = {
  get: (trainingId, uid) => getVal(`trainingCompletions/${trainingId}/${uid}`),

  complete: async (trainingId, uid, data) => {
    const record = {
      uid,
      trainingId,
      completedAt: data.completedAt ?? Date.now(),
      signedAt: data.signedAt ?? Date.now(),
      signatureUrl: data.signatureUrl ?? "",
      status: data.status ?? "completed",
      ...data,
    };
    const updates = {};
    updates[`trainingCompletions/${trainingId}/${uid}`] = record;
    updates[`userCompletions/${uid}/${trainingId}`]     = record;
    return update(ref(db), updates);
  },

  forTraining: (trainingId) => getList(`trainingCompletions/${trainingId}`),
  forUser:     (uid)        => getList(`userCompletions/${uid}`),
};

/* ══════════════════════════════════════════════════════════
   ★ 신규: Training Items  /trainingItems/{itemId}
   교육 항목(템플릿) — 교육명·유형·강사·기본 설정을 관리
   companyId 로 회사별 분리
══════════════════════════════════════════════════════════ */
export const trainingItemsDB = {
  get:    (id)         => getVal(`trainingItems/${id}`),

  create: (data) => {
    const now = Date.now();
    return push(r("trainingItems"), {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    });
  },

  update: (id, data) => update(r("trainingItems", id), {
    ...data,
    updatedAt: Date.now(),
  }),

  delete: (id) => remove(r("trainingItems", id)),

  /** 회사별 목록 */
  list:    (companyId) => getList("trainingItems", "companyId", companyId),
  /** 전체 목록 (슈퍼관리자용) */
  listAll: ()          => getList("trainingItems"),

  /** 특정 강사가 담당하는 항목 목록 */
  listByInstructor: (instructorId) =>
    getList("trainingItems", "instructorId", instructorId),
};

/* ══════════════════════════════════════════════════════════
   ★ 신규: Training Sessions  /trainingSessions/{sessionId}
   교육 회차(실시) — 항목 하나에 여러 회차
   itemId 로 항목과 연결, companyId 로 회사별 분리
══════════════════════════════════════════════════════════ */
export const trainingSessionsDB = {
  get:    (id)         => getVal(`trainingSessions/${id}`),

  create: (data) => {
    const now = Date.now();
    return push(r("trainingSessions"), {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    });
  },

  update: (id, data) => update(r("trainingSessions", id), {
    ...data,
    updatedAt: Date.now(),
  }),

  /** 회차 종료 처리 */
  close: (id, data = {}) => update(r("trainingSessions", id), {
    ...data,
    status: "closed",
    closedAt: Date.now(),
    updatedAt: Date.now(),
  }),

  /** 회차 완료 처리 — 이 시점에 직원 이력카드 PASS 생성 */
  complete: (id, data = {}) => update(r("trainingSessions", id), {
    ...data,
    status: "completed",
    completedAt: Date.now(),
    updatedAt: Date.now(),
  }),

  delete: (id) => remove(r("trainingSessions", id)),

  /** 특정 교육 항목의 전체 회차 */
  listByItem:    (itemId)    => getList("trainingSessions", "itemId", itemId),
  /** 회사별 전체 회차 */
  list:          (companyId) => getList("trainingSessions", "companyId", companyId),
  /** 전체 조회 (슈퍼관리자용) */
  listAll:       ()          => getList("trainingSessions"),

  /** 회차 + 연결된 항목/배정/수료 일괄 삭제 */
  deleteCascade: async (sessionId) => {
    const [assignments, completions] = await Promise.all([
      getList(`sessionAssignments/${sessionId}`),
      getList(`sessionCompletions/${sessionId}`),
    ]);
    const updates = { [`trainingSessions/${sessionId}`]: null };
    assignments.forEach(({ uid }) => {
      updates[`sessionAssignments/${sessionId}/${uid}`] = null;
      updates[`userSessionAssignments/${uid}/${sessionId}`] = null;
    });
    completions.forEach(({ uid }) => {
      updates[`sessionCompletions/${sessionId}/${uid}`] = null;
      updates[`userSessionCompletions/${uid}/${sessionId}`] = null;
    });
    return update(ref(db), updates);
  },
};

/* ══════════════════════════════════════════════════════════
   ★ 신규: Session Assignments
   /sessionAssignments/{sessionId}/{uid}
   /userSessionAssignments/{uid}/{sessionId}
══════════════════════════════════════════════════════════ */
export const sessionAssignmentsDB = {
  forSession: (sessionId) => getList(`sessionAssignments/${sessionId}`),
  forUser:    (uid)       => getList(`userSessionAssignments/${uid}`),

  assignUsers: async (sessionId, users, extraData = {}) => {
    const updates = {};
    const assignedAt = extraData.assignedAt ?? Date.now();
    users.forEach((user) => {
      const uid = user.uid ?? user.id;
      if (!uid) return;
      const record = {
        uid,
        sessionId,
        assignedAt,
        assignedBy:   extraData.assignedBy ?? "",
        status:       "pending",
        sessionTitle: extraData.sessionTitle ?? "",
        itemId:       extraData.itemId ?? "",
        deadline:     extraData.deadline ?? null,
        employeeName: user.name ?? "",
        empNo:        user.empNo ?? "",
        branchId:     user.branchId ?? "",
        branchName:   user.branchName ?? "",
        companyId:    user.companyId ?? "",
        companyName:  user.companyName ?? "",
      };
      updates[`sessionAssignments/${sessionId}/${uid}`]      = record;
      updates[`userSessionAssignments/${uid}/${sessionId}`]  = record;
    });
    return update(ref(db), updates);
  },

  remove: async (sessionId, uid) => {
    const updates = {
      [`sessionAssignments/${sessionId}/${uid}`]:     null,
      [`userSessionAssignments/${uid}/${sessionId}`]: null,
    };
    return update(ref(db), updates);
  },
};

/* ══════════════════════════════════════════════════════════
   ★ 신규: Session Completions
   /sessionCompletions/{sessionId}/{uid}
   /userSessionCompletions/{uid}/{sessionId}
   회차 완료 처리 시 생성 → 직원 교육이력카드 PASS 근거
══════════════════════════════════════════════════════════ */
export const sessionCompletionsDB = {
  get: (sessionId, uid) => getVal(`sessionCompletions/${sessionId}/${uid}`),

  complete: async (sessionId, uid, data) => {
    const record = {
      uid,
      sessionId,
      itemId:       data.itemId ?? "",
      completedAt:  data.completedAt ?? Date.now(),
      status:       "completed",
      // 이력카드 표시용 필드
      trainingTitle:   data.trainingTitle ?? "",
      trainingType:    data.trainingType ?? "other",
      instructorName:  data.instructorName ?? "",
      startDate:       data.startDate ?? null,
      endDate:         data.endDate ?? null,
      completedBy:     data.completedBy ?? "",
      completedByName: data.completedByName ?? "",
      ...data,
    };
    const updates = {
      [`sessionCompletions/${sessionId}/${uid}`]:     record,
      [`userSessionCompletions/${uid}/${sessionId}`]: record,
    };
    return update(ref(db), updates);
  },

  forSession: (sessionId) => getList(`sessionCompletions/${sessionId}`),
  forUser:    (uid)       => getList(`userSessionCompletions/${uid}`),
  listAll:    ()          => getList("sessionCompletions"),
};


/* ══════════════════════════════════════════════════════════
   Manual Training Histories
   /manualTrainingHistories/{historyId}
   /userManualTrainingHistories/{uid}/{historyId}
   본사 교육관리자가 입력/업로드하는 기존 개인 교육이력
══════════════════════════════════════════════════════════ */
export const manualTrainingHistoriesDB = {
  get:     (historyId) => getVal(`manualTrainingHistories/${historyId}`),
  forUser: (uid)       => getList(`userManualTrainingHistories/${uid}`),
  listAll: ()          => getList("manualTrainingHistories"),
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
══════════════════════════════════════════════════════════ */
export const instructorDB = {
  getLessonPlan:  (uid, tid)       => getVal(`lessonPlans/${uid}/${tid}`),
  saveLessonPlan: (uid, tid, data) => set(r(`lessonPlans/${uid}`, tid), { ...data, updatedAt: Date.now() }),
  getCueCard:     (uid, tid)       => getVal(`cueCards/${uid}/${tid}`),
  saveCueCard:    (uid, tid, data) => set(r(`cueCards/${uid}`, tid), { ...data, updatedAt: Date.now() }),
};

/* ══════════════════════════════════════════════════════════
   Settings  /settings/{key}
══════════════════════════════════════════════════════════ */
export const settingsDB = {
  getNotifications: ()       => getVal("settings/notifications"),
  setNotifications: (data)   => set(r("settings", "notifications"), data),
  get:  (key)                => getVal(`settings/${key}`),
  set:  (key, data)          => set(r("settings", key), data),
};

export const batchDB = {
  update: (updates) => update(ref(db), updates),
};

/* ══════════════════════════════════════════════════════════
   Education Cycle Configs
   /educationCycleConfigs/{companyId}/{educationKey}
   교육 항목별 재교육 주기 기본 설정 (HQ_ADMIN이 관리대장에서 설정)
══════════════════════════════════════════════════════════ */
export const educationCycleConfigsDB = {
  get:    (companyId, educationKey) => getVal(`educationCycleConfigs/${companyId}/${educationKey}`),
  set:    (companyId, educationKey, data) =>
    set(r(`educationCycleConfigs/${companyId}`, educationKey), { ...data, updatedAt: Date.now() }),
  update: (companyId, educationKey, data) =>
    update(r(`educationCycleConfigs/${companyId}`, educationKey), { ...data, updatedAt: Date.now() }),
  listAll: (companyId) => getList(`educationCycleConfigs/${companyId}`),
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
