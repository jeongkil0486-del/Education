export const DEFAULT_DEADLINE_BUCKETS = [
  {
    key: "bucket1",
    label: "D-30 이내",
    type: "withinDays",
    days: 30,
    enabled: true,
    notify: false,
  },
  {
    key: "bucket2",
    label: "D-14 이내",
    type: "withinDays",
    days: 14,
    enabled: true,
    notify: true,
  },
  {
    key: "bucket3",
    label: "D-7 이내",
    type: "withinDays",
    days: 7,
    enabled: true,
    notify: true,
  },
  {
    key: "bucket4",
    label: "완료된 교육",
    type: "completed",
    days: null,
    enabled: true,
    notify: false,
  },
];

export const DEFAULT_NOTIFICATION_SETTINGS = {
  alertDays: 3,
  showOverdueBanner: true,
  showExpiringSoon: true,
  deadlineBuckets: DEFAULT_DEADLINE_BUCKETS,
};

export function normalizeDeadlineBuckets(input) {
  return DEFAULT_DEADLINE_BUCKETS.map((defaultBucket, index) => {
    const source = Array.isArray(input)
      ? input.find((item) => item?.key === defaultBucket.key) ?? input[index] ?? {}
      : {};

    const type = source?.type === "overdue" ? "overdue"
              : source?.type === "completed" ? "completed"
              : "withinDays";
    const fallbackDays = defaultBucket.days ?? 0;
    const parsedDays = Number(source?.days);

    return {
      key: String(source?.key ?? defaultBucket.key),
      label: String(source?.label ?? defaultBucket.label).trim() || defaultBucket.label,
      type,
      days: type === "withinDays"
        ? normalizeDays(Number.isFinite(parsedDays) ? parsedDays : fallbackDays)
        : null,  // overdue / completed 는 days 불필요
      enabled: source?.enabled ?? defaultBucket.enabled,
      notify: source?.notify ?? defaultBucket.notify,
    };
  });
}

export function normalizeNotificationSettings(settings = {}) {
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...settings,
    deadlineBuckets: normalizeDeadlineBuckets(settings?.deadlineBuckets),
  };
}

export function bucketIncludesTraining(bucket, training, now = Date.now()) {
  if (!bucket?.enabled) return false;

  // ── 완료된 교육 카드: status=completed 만 카운트
  if (bucket.type === "completed") {
    return training?.computedStatus === "completed" || training?.status === "completed";
  }

  // ── D-N / 기한초과 카드: completed 교육은 제외
  if (!training?.deadline) return false;
  if (training?.computedStatus === "completed" || training?.status === "completed" || training?.completedAt) return false;
  if (training?.computedStatus === "closed" || training?.status === "closed" || training?.closedAt) return false;

  if (bucket.type === "overdue") {
    return Number(training.deadline) < now;
  }

  const days = normalizeDays(bucket.days ?? 0);
  const diffMs = Number(training.deadline) - now;
  if (diffMs < 0) return false;

  return diffMs <= days * 24 * 60 * 60 * 1000;
}

export function getVisibleDeadlineBuckets(settings) {
  return normalizeNotificationSettings(settings).deadlineBuckets.filter((bucket) => bucket.enabled);
}

function normalizeDays(days) {
  const safeDays = Math.floor(Number(days));
  return Number.isFinite(safeDays) ? Math.max(1, safeDays) : 1;
}
