// ============================================================
// 业务文件 1：规则层（rules.ts）
// 纯函数，不碰界面、不碰 localStorage。
// 负责：坐标核验、训放点去重、时间核验、距离偏差核验、
//       排行、未归巢提醒、配对候选、旧结果快照。
// ============================================================

/** 距离登记值与实测值允许的偏差比例：5% */
export const DISTANCE_TOLERANCE = 0.05;
/** 更正后恢复有效需要的复测人数：两人 */
export const REQUIRED_RECHECKS = 2;

export type WorkflowState = "normal" | "awaiting-confirm";
export type IssueKind = "missing-coord" | "time-inverted" | "distance-deviation";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Loft {
  id: string;
  name: string;
  coord: LatLng | null;
  createdAt: string;
}

/** 训放点：按「鸽棚 + 坐标」唯一，重复只留首次 */
export interface TrainingPoint {
  key: string; // `${loftId}|${lat}|${lng}`
  loftId: string;
  coord: LatLng;
  firstRecordId: string;
  firstSeen: string;
}

export interface TrainingRecord {
  id: string;
  loftId: string;
  ring: string; // 足环号
  blood: string; // 血统
  releaseAt: string | null; // 放飞时刻 ISO
  homeAt: string | null; // 归巢时刻 ISO（未归巢为 null）
  coord: LatLng | null; // 训放点坐标
  distanceKm: number | null; // 登记距离（公里）
  weather: string; // 天气
  createdAt: string;
  /** 更正后的工作流状态；null 表示从未被更正，等同 normal */
  workflow: WorkflowState;
  /** 已提交复测的复核人（两人不同才恢复） */
  confirmations: string[];
  /** 最近一次更正信息 */
  correction?: {
    by: string;
    at: string;
    reason: string;
    fields: string[];
  };
}

export interface Issue {
  kind: IssueKind;
  message: string;
}

/** 单条记录的核验结果（规则 2：只进待复核） */
export interface Inspection {
  issues: Issue[];
  /** 鸽棚坐标到训放点坐标的大圆实测距离 */
  actualKm: number | null;
  deviationPct: number | null;
  status: "active" | "review" | "awaiting";
}

export interface RankEntry {
  recordId: string;
  loftId: string;
  ring: string;
  blood: string;
  distanceKm: number;
  releaseAt: string;
  homeAt: string;
  flightMin: number;
  speed: number; // 米/分钟
  weather: string;
}

export interface ReminderEntry {
  recordId: string;
  loftId: string;
  ring: string;
  blood: string;
  releaseAt: string;
  elapsedMin: number; // 自放飞起经过的分钟数
  weather: string;
}

export interface PairEntry {
  ring: string;
  blood: string;
  loftId: string;
  finishes: number;
  avgSpeed: number; // 米/分钟
  bestSpeed: number;
  homeRate: number; // 归巢率
  lastHomeAt: string | null;
}

/** 一次完整的派生结果：排行 / 提醒 / 候选。更正前据此生成快照，旧结果可查 */
export interface DerivedResults {
  generatedAt: string;
  activeCount: number;
  reviewCount: number;
  awaitingCount: number;
  rankings: RankEntry[];
  reminders: ReminderEntry[];
  pairings: PairEntry[];
}

/** 旧结果快照（更正坐标或时刻时冻结一份） */
export interface ResultSnapshot {
  id: string;
  version: number; // 归档版本：更正即递增
  reason: string;
  changedRecordId: string;
  by: string;
  at: string;
  results: DerivedResults;
}

export const ISSUE_TEXT: Record<IssueKind, string> = {
  "missing-coord": "坐标缺失",
  "time-inverted": "时间倒置",
  "distance-deviation": "距离偏差超 5%",
};

// ------------------------------------------------------------
// 基础工具
// ------------------------------------------------------------

/** 保留 6 位小数，避免录入抖动造成同一训放点重复 */
export function coordKey(lat: number, lng: number): string {
  return `${round6(lat)}|${round6(lng)}`;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function parseLatLng(text: string): LatLng | null {
  const m = text
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function isValidCoord(c: LatLng | null | undefined): c is LatLng {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}

/** Haversine 大圆距离（公里） */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function formatKm(km: number | null): string {
  if (km == null) return "—";
  return `${km.toFixed(2)} km`;
}

export function formatSpeed(mPerMin: number): string {
  return `${mPerMin.toFixed(1)} m/min`;
}

export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} 分钟`;
  return `${h} 小时 ${rest} 分`;
}

// ------------------------------------------------------------
// 规则 1：训放点按鸽棚和坐标唯一，重复只留首次
// ------------------------------------------------------------

/** 登记记录时判断坐标是否对应已知训放点（首次出现则自动建档） */
export function findPoint(
  points: TrainingPoint[],
  loftId: string,
  coord: LatLng,
): TrainingPoint | undefined {
  const key = `${loftId}|${coordKey(coord.lat, coord.lng)}`;
  return points.find((p) => p.key === key);
}

export function registerPoint(
  points: TrainingPoint[],
  loftId: string,
  coord: LatLng,
  recordId: string,
  at: string,
): { points: TrainingPoint[]; point: TrainingPoint; reused: boolean } {
  const existing = findPoint(points, loftId, coord);
  if (existing) return { points, point: existing, reused: true };
  const point: TrainingPoint = {
    key: `${loftId}|${coordKey(coord.lat, coord.lng)}`,
    loftId,
    coord: { lat: round6(coord.lat), lng: round6(coord.lng) },
    firstRecordId: recordId,
    firstSeen: at,
  };
  return { points: [...points, point], point, reused: false };
}

// ------------------------------------------------------------
// 规则 2：坐标缺失 / 时间倒置 / 距离偏差 > 5% 只进待复核
// ------------------------------------------------------------

export function inspectRecord(
  record: TrainingRecord,
  loft: Loft | undefined,
): Inspection {
  const issues: Issue[] = [];
  let actualKm: number | null = null;
  let deviationPct: number | null = null;

  // (a) 坐标缺失
  if (!isValidCoord(record.coord)) {
    issues.push({
      kind: "missing-coord",
      message: "训放坐标缺失，无法核验位置与距离",
    });
  }

  // (b) 时间倒置：归巢早于放飞
  const releaseTs = record.releaseAt ? Date.parse(record.releaseAt) : NaN;
  const homeTs = record.homeAt ? Date.parse(record.homeAt) : NaN;
  if (
    Number.isFinite(releaseTs) &&
    Number.isFinite(homeTs) &&
    homeTs < releaseTs
  ) {
    issues.push({
      kind: "time-inverted",
      message: `归巢时刻早于放飞时刻（倒置 ${formatDuration((releaseTs - homeTs) / 60000)}）`,
    });
  }

  // (c) 距离偏差超过 5%
  if (isValidCoord(record.coord) && loft?.coord && record.distanceKm != null) {
    actualKm = haversineKm(loft.coord, record.coord);
    if (actualKm > 0) {
      deviationPct = Math.abs(record.distanceKm - actualKm) / actualKm;
      if (deviationPct > DISTANCE_TOLERANCE) {
        issues.push({
          kind: "distance-deviation",
          message: `登记 ${record.distanceKm.toFixed(2)} km，实测 ${actualKm.toFixed(2)} km，偏差 ${(deviationPct * 100).toFixed(1)}%（限 ${DISTANCE_TOLERANCE * 100}%）`,
        });
      }
    }
  }

  const status: Inspection["status"] =
    record.workflow === "awaiting-confirm"
      ? "awaiting"
      : issues.length > 0
        ? "review"
        : "active";

  return { issues, actualKm, deviationPct, status };
}

// ------------------------------------------------------------
// 规则 3：排行 / 未归巢提醒 / 配对候选只取有效记录
// 规则 4：按血统筛选
// ------------------------------------------------------------

export interface ComputeInput {
  lofts: Loft[];
  records: TrainingRecord[];
  blood?: string | null; // 血统筛选
  now?: number; // 当前时刻（便于测试）
}

export function computeResults(input: ComputeInput): DerivedResults {
  const now = input.now ?? Date.now();
  const blood = input.blood?.trim() || null;
  const lofts = new Map(input.lofts.map((l) => [l.id, l]));

  const matchBlood = (b: string) => !blood || b === blood;

  let activeCount = 0;
  let reviewCount = 0;
  let awaitingCount = 0;

  const rankings: RankEntry[] = [];
  const reminders: ReminderEntry[] = [];
  type PigeonAgg = {
    ring: string;
    blood: string;
    loftId: string;
    speeds: number[];
    finished: number;
    released: number;
    lastHomeAt: string | null;
  };
  const pigeons = new Map<string, PigeonAgg>();

  for (const r of input.records) {
    const insp = inspectRecord(r, lofts.get(r.loftId));
    if (insp.status === "review") reviewCount += 1;
    else if (insp.status === "awaiting") awaitingCount += 1;
    else activeCount += 1;

    // 待复核 / 待复测确认：不计排行、未归巢提醒和配对候选
    if (insp.status !== "active" || !matchBlood(r.blood)) continue;

    const releaseTs = r.releaseAt ? Date.parse(r.releaseAt) : NaN;

    // 归巢且时刻正常 → 排行
    if (
      r.homeAt &&
      Number.isFinite(releaseTs) &&
      Number.isFinite(Date.parse(r.homeAt)) &&
      r.distanceKm != null
    ) {
      const homeTs = Date.parse(r.homeAt);
      const flightMin = (homeTs - releaseTs) / 60000;
      if (flightMin > 0) {
        rankings.push({
          recordId: r.id,
          loftId: r.loftId,
          ring: r.ring,
          blood: r.blood,
          distanceKm: r.distanceKm,
          releaseAt: r.releaseAt as string,
          homeAt: r.homeAt,
          flightMin,
          speed: (r.distanceKm * 1000) / flightMin,
          weather: r.weather,
        });
      }
    }

    // 已放飞但未归巢 → 提醒
    if (!r.homeAt && Number.isFinite(releaseTs)) {
      reminders.push({
        recordId: r.id,
        loftId: r.loftId,
        ring: r.ring,
        blood: r.blood,
        releaseAt: r.releaseAt as string,
        elapsedMin: (now - releaseTs) / 60000,
        weather: r.weather,
      });
    }

    // 配对候选：按足环汇总有效成绩
    if (Number.isFinite(releaseTs)) {
      let agg = pigeons.get(r.ring);
      if (!agg) {
        agg = {
          ring: r.ring,
          blood: r.blood,
          loftId: r.loftId,
          speeds: [],
          finished: 0,
          released: 0,
          lastHomeAt: null,
        };
        pigeons.set(r.ring, agg);
      }
      agg.released += 1;
      if (r.homeAt) {
        agg.finished += 1;
        const flightMin = (Date.parse(r.homeAt) - releaseTs) / 60000;
        if (flightMin > 0 && r.distanceKm != null) {
          agg.speeds.push((r.distanceKm * 1000) / flightMin);
        }
        if (!agg.lastHomeAt || r.homeAt > agg.lastHomeAt) {
          agg.lastHomeAt = r.homeAt;
        }
      }
    }
  }

  // 排行：速度降序，并列时归巢早的在前
  rankings.sort((a, b) =>
    b.speed !== a.speed ? b.speed - a.speed : a.homeAt.localeCompare(b.homeAt),
  );

  // 提醒：滞留最久的在前
  reminders.sort((a, b) => b.elapsedMin - a.elapsedMin);

  // 配对候选：至少一羽有效归巢成绩，按平均速度降序
  const pairings: PairEntry[] = [...pigeons.values()]
    .filter((p) => p.finished > 0)
    .map((p) => ({
      ring: p.ring,
      blood: p.blood,
      loftId: p.loftId,
      finishes: p.finished,
      avgSpeed: p.speeds.reduce((s, v) => s + v, 0) / (p.speeds.length || 1),
      bestSpeed: p.speeds.length ? Math.max(...p.speeds) : 0,
      homeRate: p.released ? p.finished / p.released : 0,
      lastHomeAt: p.lastHomeAt,
    }))
    .sort((a, b) =>
      b.avgSpeed !== a.avgSpeed
        ? b.avgSpeed - a.avgSpeed
        : b.finishes - a.finishes,
    );

  return {
    generatedAt: new Date(now).toISOString(),
    activeCount,
    reviewCount,
    awaitingCount,
    rankings,
    reminders,
    pairings,
  };
}

// ------------------------------------------------------------
// 规则 5：两人复测确认才恢复（两人姓名必须不同，且更正人可参与）
// ------------------------------------------------------------

export function applyConfirmation(
  current: string[],
  reviewer: string,
): { confirmations: string[]; restored: boolean; error?: string } {
  const name = reviewer.trim();
  if (!name) return { confirmations: current, restored: false, error: "请填写复核人姓名" };
  if (current.includes(name)) {
    return { confirmations: current, restored: false, error: "同一复核人不能重复确认" };
  }
  const next = [...current, name];
  return { confirmations: next, restored: next.length >= REQUIRED_RECHECKS };
}
