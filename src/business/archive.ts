/**
 * 业务文件二 · 档案（持久化与工作流）
 * ------------------------------
 * 负责离线存档（localStorage）、登记去重、更正冻结、两人复测恢复、
 * 旧结果快照留档。所有写操作都返回新档案，界面层据此刷新；
 * 刷新页面后从同一存档重新推演，各处状态天然一致。
 */

import {
  deriveAll,
  EnrichedRecord,
  FlightRecord,
  HistorySnapshot,
  Issue,
  newHistoryId,
  newRecordId,
  parseCoord,
  parseLocalTime,
} from "./rules";

const STORAGE_KEY = "pigeon-loft-archive-v1";

export interface Store {
  version: 1;
  records: FlightRecord[];
  history: HistorySnapshot[];
}

// ---------- 持久化 ----------

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedStore();
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return seedStore();
    }
    return {
      version: 1,
      records: parsed.records.map(repairRecord),
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return seedStore();
  }
}

export function saveStore(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function emptyStore(): Store {
  return { version: 1, records: [], history: [] };
}

function repairRecord(r: Partial<FlightRecord>): FlightRecord {
  return {
    id: typeof r.id === "string" ? r.id : newRecordId(),
    ring: String(r.ring ?? "").trim(),
    bloodline: String(r.bloodline ?? ""),
    loft: String(r.loft ?? ""),
    lat: String(r.lat ?? ""),
    lng: String(r.lng ?? ""),
    releaseAt: String(r.releaseAt ?? ""),
    returnAt: String(r.returnAt ?? ""),
    distanceKm:
      r.distanceKm === null || r.distanceKm === undefined || Number.isNaN(Number(r.distanceKm))
        ? null
        : Number(r.distanceKm),
    weather: String(r.weather ?? ""),
    regAt: typeof r.regAt === "string" ? r.regAt : new Date().toISOString(),
    status: r.status === "active" || r.status === "review" || r.status === "frozen"
      ? r.status
      : "review",
    confirmers: Array.isArray(r.confirmers) ? r.confirmers.map(String) : [],
    correctedBy: r.correctedBy,
    frozenHistoryId: r.frozenHistoryId,
    note: r.note,
  };
}

// ---------- 登记 ----------

export interface RecordInput {
  ring: string;
  bloodline: string;
  loft: string;
  lat: string;
  lng: string;
  releaseAt: string;
  returnAt: string;
  distanceKm: number | null;
  weather: string;
  note?: string;
}

export interface AddResult {
  store: Store;
  recordId: string;
  issues: Issue[];
  /** 与既有有效档案完全重复（同足环+同训放点+同放飞时刻），按规则只留首次，拒绝入库 */
  duplicate: boolean;
}

export function addRecord(store: Store, input: RecordInput): AddResult {
  const candidate: FlightRecord = {
    id: newRecordId(),
    ring: input.ring.trim(),
    bloodline: input.bloodline.trim(),
    loft: input.loft.trim(),
    lat: input.lat.trim(),
    lng: input.lng.trim(),
    releaseAt: input.releaseAt,
    returnAt: input.returnAt,
    distanceKm: input.distanceKm,
    weather: input.weather.trim(),
    regAt: new Date().toISOString(),
    status: "review",
    confirmers: [],
    note: input.note?.trim(),
  };

  const coord = parseCoord(candidate.lat, candidate.lng);
  const relAt = parseLocalTime(candidate.releaseAt);
  if (coord && relAt !== null) {
    const dup = store.records.find(
      (r) =>
        r.status !== "frozen" &&
        r.ring === candidate.ring &&
        r.loft === candidate.loft &&
        parseCoord(r.lat, r.lng)?.lat === coord.lat &&
        parseCoord(r.lat, r.lng)?.lng === coord.lng &&
        parseLocalTime(r.releaseAt) === relAt
    );
    if (dup) {
      const derived = deriveAll(store.records);
      return {
        store,
        recordId: dup.id,
        issues: derived.records.find((x) => x.id === dup.id)?.issues ?? [],
        duplicate: true,
      };
    }
  }

  const trial = deriveAll([...store.records, candidate]);
  const mine = trial.records.find((r) => r.id === candidate.id)!;
  candidate.status = mine.issues.length === 0 ? "active" : "review";

  const next: Store = { ...store, records: [...store.records, candidate] };
  saveStore(next);
  return { store: next, recordId: candidate.id, issues: mine.issues, duplicate: false };
}

// ---------- 普通档案字段（不触发冻结） ----------

export function patchProfile(
  store: Store,
  id: string,
  patch: Partial<Pick<FlightRecord, "bloodline" | "weather" | "note">>
): Store {
  const next: Store = {
    ...store,
    records: store.records.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  saveStore(next);
  return next;
}

// ---------- 更正：坐标 / 时刻 / 距离 → 冻结，旧结果留档 ----------

export type VerifiablePatch = Partial<
  Pick<FlightRecord, "lat" | "lng" | "releaseAt" | "returnAt" | "distanceKm">
>;

export function correctRecord(
  store: Store,
  id: string,
  patch: VerifiablePatch,
  correctedBy: string,
  reason: string
): { store: Store; historyId: string } | { error: string } {
  const rec = store.records.find((r) => r.id === id);
  if (!rec) return { error: "记录不存在" };
  if (rec.status === "frozen") return { error: "该记录正在复测中，须先完成两人复测确认" };
  const by = correctedBy.trim();
  if (!by) return { error: "请填写更正人姓名" };

  const historyId = newHistoryId();
  const before = deriveAll(store.records);
  const enrichedBefore = before.records.find((r) => r.id === id) as EnrichedRecord;

  const snapshot: HistorySnapshot = {
    id: historyId,
    recordId: id,
    at: new Date().toISOString(),
    correctedBy: by,
    reason: reason.trim() || "（未填更正说明）",
    confirmers: [],
    snapshot: stripEnriched(before),
    label: `${rec.ring} · ${rec.loft || "未知鸽棚"} · 更正于 ${formatDateTime(Date.now())}`,
    restored: false,
  };

  const updated: FlightRecord = {
    ...rec,
    ...normalizePatch(patch),
    status: "frozen",
    confirmers: [],
    correctedBy: by,
    frozenHistoryId: historyId,
  };

  void enrichedBefore;
  const next: Store = {
    version: 1,
    records: store.records.map((r) => (r.id === id ? updated : r)),
    history: [snapshot, ...store.history],
  };
  saveStore(next);
  return { store: next, historyId };
}

// ---------- 两人复测确认 ----------

export function confirmRetest(
  store: Store,
  id: string,
  person: string
): { store: Store; restored: boolean; issues: Issue[] } | { error: string } {
  const rec = store.records.find((r) => r.id === id);
  if (!rec) return { error: "记录不存在" };
  if (rec.status !== "frozen") return { error: "该记录不在待复测状态" };
  const name = person.trim();
  if (!name) return { error: "请填写复测人姓名" };
  if (rec.correctedBy && name === rec.correctedBy) {
    return { error: "复测人不能与更正人为同一人" };
  }
  if (rec.confirmers.includes(name)) {
    return { error: `${name} 已完成复测确认，请勿重复签署` };
  }

  const confirmers = [...rec.confirmers, name];

  if (confirmers.length < 2) {
    const next: Store = {
      ...store,
      records: store.records.map((r) => (r.id === id ? { ...r, confirmers } : r)),
      history: store.history.map((h) =>
        h.id === rec.frozenHistoryId ? { ...h, confirmers } : h
      ),
    };
    saveStore(next);
    return { store: next, restored: false, issues: [] };
  }

  // 第二人确认 → 恢复：重新核验，无问题回排行/提醒/候选，仍有问题则进待复核
  const candidate: FlightRecord = { ...rec, confirmers, status: "active" };
  const derived = deriveAll(
    store.records.map((r) => (r.id === id ? candidate : r))
  );
  const mine = derived.records.find((r) => r.id === id)!;
  const finalStatus: FlightRecord["status"] = mine.issues.length === 0 ? "active" : "review";

  const restored: FlightRecord = {
    ...rec,
    confirmers,
    status: finalStatus,
    frozenHistoryId: undefined,
  };

  const next: Store = {
    version: 1,
    records: store.records.map((r) => (r.id === id ? restored : r)),
    history: store.history.map((h) =>
      h.id === rec.frozenHistoryId
        ? { ...h, confirmers, restored: true, restoredAt: new Date().toISOString() }
        : h
    ),
  };
  saveStore(next);
  return { store: next, restored: true, issues: mine.issues };
}

export function resetStore(store: Store): Store {
  const fresh = seedStore();
  saveStore(fresh);
  void store;
  return fresh;
}

// ---------- 工具 ----------

function normalizePatch(patch: VerifiablePatch): VerifiablePatch {
  const out: VerifiablePatch = {};
  if (patch.lat !== undefined) out.lat = patch.lat.trim();
  if (patch.lng !== undefined) out.lng = patch.lng.trim();
  if (patch.releaseAt !== undefined) out.releaseAt = patch.releaseAt;
  if (patch.returnAt !== undefined) out.returnAt = patch.returnAt;
  if (patch.distanceKm !== undefined) out.distanceKm = patch.distanceKm;
  return out;
}

/** 快照只存可序列化的纯数据视图 */
function stripEnriched(d: ReturnType<typeof deriveAll>) {
  return JSON.parse(
    JSON.stringify({
      points: d.points,
      records: d.records,
      ranking: d.ranking,
      reminders: d.reminders,
      candidates: d.candidates,
      missingCoordLofts: d.missingCoordLofts,
      counts: d.counts,
    })
  ) as ReturnType<typeof deriveAll>;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

// ---------- 示例档案（首次打开自动生成） ----------

function seedStore(): Store {
  const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60000).toISOString();
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const dt = (dayOffset: number, h: number, m: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(h)}:${p(m)}`;
  };

  const rec = (
    ring: string,
    bloodline: string,
    loft: string,
    lat: string,
    lng: string,
    releaseAt: string,
    returnAt: string,
    distanceKm: number | null,
    weather: string,
    status: FlightRecord["status"],
    order: number,
    note = ""
  ): FlightRecord => ({
    id: newRecordId(),
    ring,
    bloodline,
    loft,
    lat,
    lng,
    releaseAt,
    returnAt,
    distanceKm,
    weather,
    regAt: iso(order),
    status,
    confirmers: [],
    note,
  });

  const records: FlightRecord[] = [
    // 顺义北务训放点：首次登记定基准 80km
    rec("CHN-24-001839", "詹森系", "顺义北务", "40.125400", "116.892100",
      dt(-2, 7, 0), dt(-2, 8, 12), 80, "晴", "active", -60, "健康正常"),
    rec("CHN-24-002114", "凡龙系", "顺义北务", "40.125400", "116.892100",
      dt(-2, 7, 0), dt(-2, 8, 40), 80, "晴", "active", -59, "侧风，归巢延迟"),
    rec("CHN-24-003027", "胡本系", "顺义北务", "40.125400", "116.892100",
      dt(-2, 7, 0), "", 80, "晴", "active", -58, "在飞，等待归巢"),
    // 同点距离偏差 9.4% → 待复核
    rec("CHN-23-008771", "詹森系", "顺义北务", "40.125400", "116.892100",
      dt(-2, 7, 0), dt(-2, 8, 55), 87.5, "晴", "review", -57, "GPS 读数可疑"),
    // 坐标缺失 → 待复核
    rec("CHN-24-004521", "凡龙系", "通州永乐店", "", "",
      dt(-1, 6, 30), "", 120, "多云", "review", -56, "司放员未回报坐标"),
    // 时间倒置 → 待复核
    rec("CHN-23-006630", "盖比系", "武清大孟庄", "39.541200", "117.027600",
      dt(-3, 7, 10), dt(-3, 6, 58), 150, "阴", "review", -55, "计时器疑似未校准"),
    // 第二训放点，正常
    rec("CHN-24-001839", "詹森系", "武清大孟庄", "39.541200", "117.027600",
      dt(-3, 6, 50), dt(-3, 9, 2), 150, "阴", "active", -54, "状态良好"),
    rec("CHN-24-005188", "英格斯系", "武清大孟庄", "39.541200", "117.027600",
      dt(-3, 6, 50), dt(-3, 9, 31), 150, "阴", "active", -53, ""),
  ];

  const store: Store = { version: 1, records, history: [] };
  // 首启即落盘，保证刷新后仍在
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 隐私模式等场景下退化为纯内存 */
  }
  return store;
}
