// ============================================================
// 业务文件 2：档案层（archive.ts）
// 离线档案库：localStorage 持久化、登记、更正、两人复测、
// 旧结果快照、示例数据。刷新后各处状态一致靠单一存储 + 版本号。
// ============================================================

import {
  applyConfirmation,
  computeResults,
  parseLatLng,
  registerPoint,
  ResultSnapshot,
  TrainingPoint,
  TrainingRecord,
  Loft,
  DerivedResults,
  LatLng,
} from "./rules";

const STORAGE_KEY = "pigeon-loft-archive-v1";

export interface RegistrationInput {
  loftId: string;
  ring: string;
  blood: string;
  releaseAt: string | null;
  homeAt: string | null;
  coordText: string; // "纬度,经度"，可空
  distanceKm: number | null;
  weather: string;
}

export interface CorrectionInput {
  releaseAt: string | null;
  homeAt: string | null;
  coordText: string;
  distanceKm: number | null;
  reason: string;
  by: string;
}

export interface ArchiveState {
  lofts: Loft[];
  points: TrainingPoint[];
  records: TrainingRecord[];
  snapshots: ResultSnapshot[];
  seq: number;
}

// ------------------------------------------------------------
// 存储
// ------------------------------------------------------------

function emptyState(): ArchiveState {
  return { lofts: [], points: [], records: [], snapshots: [], seq: 1 };
}

export function loadArchive(): ArchiveState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as ArchiveState;
    if (!Array.isArray(parsed.records)) return seed();
    return { ...emptyState(), ...parsed };
  } catch {
    return seed();
  }
}

export function saveArchive(state: ArchiveState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetArchive(): ArchiveState {
  const fresh = seed();
  saveArchive(fresh);
  return fresh;
}

export function clearArchive(): ArchiveState {
  const fresh = emptyState();
  saveArchive(fresh);
  return fresh;
}

function nextId(state: ArchiveState, prefix: string): string {
  const id = `${prefix}-${String(state.seq).padStart(4, "0")}`;
  state.seq += 1;
  return id;
}

// ------------------------------------------------------------
// 鸽棚
// ------------------------------------------------------------

export function addLoft(
  state: ArchiveState,
  name: string,
  coord: LatLng | null,
): { state: ArchiveState; loftId: string } {
  const next = clone(state);
  const loft: Loft = {
    id: nextId(next, "loft"),
    name: name.trim() || `鸽棚 ${next.lofts.length + 1}`,
    coord,
    createdAt: new Date().toISOString(),
  };
  next.lofts.push(loft);
  saveArchive(next);
  return { state: next, loftId: loft.id };
}

// ------------------------------------------------------------
// 登记：足环、血统、时刻、坐标、距离、天气
// 训放点按鸽棚+坐标唯一，重复只留首次（重复复用训放点，不新建）
// ------------------------------------------------------------

// 坐标解析统一走规则层（界面从档案层 re-export 引用）
export { parseLatLng as parseCoordText } from "./rules";

export function registerRecord(
  state: ArchiveState,
  input: RegistrationInput,
): { state: ArchiveState; recordId: string; pointReused: boolean } | { error: string } {
  if (!input.ring.trim()) return { error: "足环号必填" };
  if (!input.blood.trim()) return { error: "血统必填" };
  if (!state.lofts.some((l) => l.id === input.loftId)) {
    return { error: "请先选择鸽棚" };
  }

  const coord = input.coordText.trim() ? parseLatLng(input.coordText) : null;
  if (input.coordText.trim() && !coord) {
    return { error: "坐标格式应为「纬度,经度」，如 39.9042,116.4074" };
  }
  if (
    input.distanceKm != null &&
    (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0)
  ) {
    return { error: "距离须为正数（公里）" };
  }

  const next = clone(state);
  const recordId = nextId(next, "rec");
  const now = new Date().toISOString();

  // 规则 1：坐标有效才参与训放点建档；重复坐标复用首次训放点
  let pointReused = false;
  if (coord) {
    const r = registerPoint(next.points, input.loftId, coord, recordId, now);
    next.points = r.points;
    pointReused = r.reused;
  }

  const record: TrainingRecord = {
    id: recordId,
    loftId: input.loftId,
    ring: input.ring.trim().toUpperCase(),
    blood: input.blood.trim(),
    releaseAt: input.releaseAt || null,
    homeAt: input.homeAt || null,
    coord,
    distanceKm: input.distanceKm,
    weather: input.weather.trim() || "未记录",
    createdAt: now,
    workflow: "normal",
    confirmations: [],
  };
  next.records.push(record);
  saveArchive(next);
  return { state: next, recordId, pointReused };
}

// ------------------------------------------------------------
// 更正坐标或时刻：
// 1) 更正前冻结一份旧结果快照（旧结果可查）
// 2) 旧排行/提醒/血统筛选失效，进入「待复测确认」，一律不参与派生
// 3) 两人不同复核人确认后才恢复，恢复时重新核验
// ------------------------------------------------------------

export function correctRecord(
  state: ArchiveState,
  recordId: string,
  input: CorrectionInput,
): { state: ArchiveState } | { error: string } {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return { error: "记录不存在" };
  if (!input.by.trim()) return { error: "请填写更正操作人" };

  const coord = input.coordText.trim() ? parseLatLng(input.coordText) : null;
  if (input.coordText.trim() && !coord) {
    return { error: "坐标格式应为「纬度,经度」" };
  }
  if (
    input.distanceKm != null &&
    (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0)
  ) {
    return { error: "距离须为正数（公里）" };
  }

  // 找出实际改动的字段
  const changed: string[] = [];
  if ((coord?.lat ?? null) !== (record.coord?.lat ?? null) ||
      (coord?.lng ?? null) !== (record.coord?.lng ?? null)) {
    changed.push("坐标");
  }
  if ((input.releaseAt || null) !== (record.releaseAt)) changed.push("放飞时刻");
  if ((input.homeAt || null) !== (record.homeAt)) changed.push("归巢时刻");
  if ((input.distanceKm ?? null) !== (record.distanceKm)) changed.push("距离");
  if (changed.length === 0) return { error: "与原登记内容一致，无需更正" };

  const next = clone(state);
  const target = next.records.find((r) => r.id === recordId)!;

  // 1) 冻结旧结果（全棚口径的旧排行/提醒/配对，血统筛选在快照查看时不二次过滤——
  //    快照记录的是更正发生时的完整旧结果，保证可追溯）
  const oldResults = computeResults({ lofts: next.lofts, records: next.records });
  const snapshot: ResultSnapshot = {
    id: nextId(next, "snap"),
    version: next.snapshots.length + 1,
    reason: input.reason.trim() || `更正：${changed.join("、")}`,
    changedRecordId: recordId,
    by: input.by.trim(),
    at: new Date().toISOString(),
    results: oldResults,
  };
  next.snapshots.push(snapshot);

  // 2) 写入更正，进入待复测确认（旧派生结果对该羽失效）
  target.coord = coord;
  target.releaseAt = input.releaseAt || null;
  target.homeAt = input.homeAt || null;
  target.distanceKm = input.distanceKm;
  target.workflow = "awaiting-confirm";
  target.confirmations = [];
  target.correction = {
    by: input.by.trim(),
    at: snapshot.at,
    reason: snapshot.reason,
    fields: changed,
  };

  // 若更正后坐标落在一个新的训放点，沿用规则 1 登记（仍只留首次）
  if (coord) {
    const r = registerPoint(next.points, target.loftId, coord, target.id, snapshot.at);
    next.points = r.points;
  }

  saveArchive(next);
  return { state: next };
}

/** 复测确认：两人不同才恢复 */
export function confirmRecord(
  state: ArchiveState,
  recordId: string,
  reviewer: string,
): { state: ArchiveState; restored: boolean } | { error: string } {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return { error: "记录不存在" };
  if (record.workflow !== "awaiting-confirm") {
    return { error: "该记录不在待复测确认状态" };
  }

  const r = applyConfirmation(record.confirmations, reviewer);
  if (r.error) return { error: r.error };

  const next = clone(state);
  const target = next.records.find((x) => x.id === recordId)!;
  target.confirmations = r.confirmations;

  if (r.restored) {
    // 恢复：退出「待复测确认」。更正后是否合格由核验规则兜底——
    // 数据仍不合格的记录会被 inspectRecord 重新归入待复核，不参与排行。
    target.workflow = "normal";
  }

  saveArchive(next);
  return { state: next, restored: r.restored };
}

/** 标记归巢（未归巢 → 已归巢，登记归巢时刻） */
export function markHome(
  state: ArchiveState,
  recordId: string,
  homeAt: string,
): { state: ArchiveState } | { error: string } {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return { error: "记录不存在" };
  const next = clone(state);
  const target = next.records.find((r) => r.id === recordId)!;
  target.homeAt = homeAt || new Date().toISOString();
  saveArchive(next);
  return { state: next };
}

// ------------------------------------------------------------
// 统一派生入口：界面所有视图都从这里取数，保证刷新后各处一致
// ------------------------------------------------------------

export function getResults(
  state: ArchiveState,
  blood?: string | null,
  now?: number,
): DerivedResults {
  return computeResults({
    lofts: state.lofts,
    records: state.records,
    blood: blood || null,
    now,
  });
}

export function bloodLines(state: ArchiveState): string[] {
  return [...new Set(state.records.map((r) => r.blood))].sort();
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ------------------------------------------------------------
// 示例数据（首次打开 / 重置时灌入，便于直接演示各规则）
// ------------------------------------------------------------

function iso(d: Date): string {
  return d.toISOString();
}

function hoursAgo(h: number, base = Date.now()): string {
  return iso(new Date(base - h * 3600_000));
}

function seed(): ArchiveState {
  const state = emptyState();
  const now = Date.now();

  // 两个鸽棚（自带棚坐标，用于距离实测核验）
  const loftA: Loft = {
    id: "loft-0001",
    name: "北辰公棚",
    coord: { lat: 39.9042, lng: 116.4074 },
    createdAt: iso(new Date(now - 30 * 86400_000)),
  };
  const loftB: Loft = {
    id: "loft-0002",
    name: "南苑私棚",
    coord: { lat: 39.7588, lng: 116.3378 },
    createdAt: iso(new Date(now - 20 * 86400_000)),
  };
  state.lofts = [loftA, loftB];

  type SeedRow = Omit<TrainingRecord, "id" | "createdAt" | "workflow" | "confirmations">;

  const rows: SeedRow[] = [
    // —— 北辰公棚：合格记录 ——
    {
      loftId: loftA.id, ring: "CHN-24-001839", blood: "詹森系",
      releaseAt: hoursAgo(26), homeAt: hoursAgo(25.42),
      coord: { lat: 39.736, lng: 115.98 }, distanceKm: 42.6, weather: "晴",
    },
    {
      loftId: loftA.id, ring: "CHN-24-001839", blood: "詹森系",
      releaseAt: hoursAgo(74), homeAt: hoursAgo(73.23),
      coord: { lat: 40.14, lng: 115.86 }, distanceKm: 53.5, weather: "西北风3级",
    },
    {
      loftId: loftA.id, ring: "CHN-24-002114", blood: "凡龙系",
      releaseAt: hoursAgo(50), homeAt: hoursAgo(49.37),
      coord: { lat: 39.736, lng: 115.98 }, distanceKm: 42.6, weather: "晴",
    },
    {
      loftId: loftA.id, ring: "CHN-23-008771", blood: "胡本系",
      releaseAt: hoursAgo(100), homeAt: hoursAgo(99.27),
      coord: { lat: 40.14, lng: 115.86 }, distanceKm: 53.5, weather: "多云",
    },
    // 未归巢（会进提醒）
    {
      loftId: loftA.id, ring: "CHN-24-003520", blood: "詹森系",
      releaseAt: hoursAgo(9), homeAt: null,
      coord: { lat: 39.736, lng: 115.98 }, distanceKm: 42.6, weather: "小雨",
    },
    // 坐标缺失 → 待复核
    {
      loftId: loftA.id, ring: "CHN-24-004107", blood: "凡龙系",
      releaseAt: hoursAgo(30), homeAt: hoursAgo(29.2),
      coord: null, distanceKm: 60, weather: "阴",
    },
    // 时间倒置（归巢早于放飞）→ 待复核
    {
      loftId: loftA.id, ring: "CHN-23-006622", blood: "胡本系",
      releaseAt: hoursAgo(40), homeAt: hoursAgo(42),
      coord: { lat: 39.5, lng: 116.0 }, distanceKm: 56, weather: "晴",
    },
    // 距离偏差超 5%（登记 80，实测约 41）→ 待复核
    {
      loftId: loftA.id, ring: "CHN-24-005931", blood: "杨阿腾",
      releaseAt: hoursAgo(60), homeAt: hoursAgo(59.3),
      coord: { lat: 39.736, lng: 115.98 }, distanceKm: 80, weather: "侧风",
    },
    // —— 南苑私棚：合格 + 同坐标二次训放（演示训放点去重）——
    {
      loftId: loftB.id, ring: "CHN-24-007218", blood: "盖比系",
      releaseAt: hoursAgo(20), homeAt: hoursAgo(19.47),
      coord: { lat: 39.52, lng: 116.02 }, distanceKm: 38.4, weather: "晴",
    },
    {
      loftId: loftB.id, ring: "CHN-24-007302", blood: "盖比系",
      releaseAt: hoursAgo(8), homeAt: null,
      coord: { lat: 39.52, lng: 116.02 }, distanceKm: 38.4, weather: "晴",
    },
  ];

  rows.forEach((row) => {
    const id = nextId(state, "rec");
    const record: TrainingRecord = {
      ...row,
      id,
      createdAt: row.releaseAt || hoursAgo(1),
      workflow: "normal",
      confirmations: [],
    };
    state.records.push(record);
    if (record.coord) {
      const r = registerPoint(state.points, record.loftId, record.coord, id, record.createdAt);
      state.points = r.points;
    }
  });

  saveArchive(state);
  return state;
}
