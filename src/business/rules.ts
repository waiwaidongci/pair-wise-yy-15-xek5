/**
 * 业务文件一 · 核验规则（纯领域逻辑）
 * --------------------------------
 * 只负责规则推演：训放点唯一性、登记核验、排行 / 未归巢 / 配对候选计算。
 * 不读写 localStorage、不接触 DOM，刷新后由档案层重新喂数据即可得到一致结果。
 */

// ---------- 领域类型 ----------

/** 登记表：一羽赛鸽在某训放点的一次训放记录 */
export interface FlightRecord {
  id: string;
  /** 足环号 */
  ring: string;
  /** 血统 */
  bloodline: string;
  /** 鸽棚 */
  loft: string;
  /** 纬度（字符串，允许留空） */
  lat: string;
  /** 经度（字符串，允许留空） */
  lng: string;
  /** 放飞时刻，本地时间 yyyy-MM-ddTHH:mm */
  releaseAt: string;
  /** 归巢时刻，可空（未归巢） */
  returnAt: string;
  /** 距离（公里），可空 */
  distanceKm: number | null;
  /** 天气 */
  weather: string;
  /** 登记时间（ISO，决定“首次”顺序） */
  regAt: string;
  /** 状态：待复核 / 有效 / 冻结（更正后等待两人复测） */
  status: "review" | "active" | "frozen";
  /** 更正时关联的历史结果条目 */
  frozenHistoryId?: string;
  /** 复测确认人（至少两位、互不相同、且不同于更正人） */
  confirmers: string[];
  /** 更正人 */
  correctedBy?: string;
  /** 备注 / 健康 */
  note?: string;
}

/** 训放点：按「鸽棚 + 坐标」唯一，重复登记只认首次 */
export interface ReleasePoint {
  id: string;
  loft: string;
  lat: number;
  lng: number;
  /** 首次登记记录 */
  firstRecordId: string;
  /** 首次放飞时刻（时间倒置核验锚点） */
  anchorAt: string | null;
  /** 基准距离（5% 偏差核验基准，来自首次登记） */
  baselineKm: number | null;
  weather: string;
  createdAt: string;
}

export type IssueCode =
  | "missing-coord"
  | "bad-coord"
  | "time-invalid"
  | "time-inverted"
  | "distance-missing"
  | "distance-deviation";

export interface Issue {
  code: IssueCode;
  detail: string;
}

export interface EnrichedRecord extends FlightRecord {
  pointId: string | null;
  issues: Issue[];
  /** 是否为该训放点的首次登记 */
  founding: boolean;
  /** 分速 米/分（可计算时） */
  speed: number | null;
  /** 飞行分钟数 */
  durationMin: number | null;
}

export interface RankingRow {
  recordId: string;
  ring: string;
  bloodline: string;
  pointId: string;
  loft: string;
  distanceKm: number;
  speed: number;
  durationMin: number;
  returnAt: string;
  releaseAt: string;
  weather: string;
}

export interface ReminderRow {
  recordId: string;
  ring: string;
  bloodline: string;
  loft: string;
  pointId: string | null;
  releaseAt: string;
  weather: string;
}

export interface CandidateRow {
  ring: string;
  bloodline: string;
  bestSpeed: number;
  flights: number;
  lastReleaseAt: string;
  partnerRing: string | null;
  partnerBloodline: string | null;
}

export interface HistorySnapshot {
  id: string;
  /** 触发更正的记录 */
  recordId: string;
  /** 更正时间 ISO */
  at: string;
  /** 更正人 */
  correctedBy: string;
  reason: string;
  /** 复测确认人 */
  confirmers: string[];
  /** 更正前的完整结果快照（旧结果可查） */
  snapshot: DerivedState;
  label: string;
  /** 复测是否已恢复 */
  restored: boolean;
  restoredAt?: string;
}

export interface DerivedState {
  points: ReleasePoint[]
  records: EnrichedRecord[];
  ranking: RankingRow[];
  reminders: ReminderRow[];
  candidates: CandidateRow[];
  /** 缺坐标待复核的鸽棚分组 */
  missingCoordLofts: { loft: string; count: number }[];
  counts: {
    total: number;
    active: number;
    review: number;
    frozen: number;
    returned: number;
    notReturned: number;
    points: number;
  };
}

// ---------- 常量 ----------

export const DISTANCE_TOLERANCE = 0.05;
const COORD_FIXED = 6;

export const ISSUE_TEXT: Record<IssueCode, string> = {
  "missing-coord": "坐标缺失",
  "bad-coord": "坐标格式错误",
  "time-invalid": "时刻无法识别",
  "time-inverted": "时间倒置（早于放飞或晚于归巢）",
  "distance-missing": "距离缺失，无法核验偏差",
  "distance-deviation": "距离偏差超过 5%",
};

// ---------- 基础解析 ----------

export function parseCoord(lat: string, lng: string): { lat: number; lng: number } | null {
  const a = lat.trim();
  const b = lng.trim();
  if (a === "" || b === "") return null;
  const la = Number(a);
  const ln = Number(b);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/** 解析本地 datetime-local 值；非空且非法返回 null（由调用方区分“空”与“非法”） */
export function parseLocalTime(value: string): number | null {
  const v = value.trim();
  if (v === "") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function pointKey(loft: string, lat: number, lng: number): string {
  return `${loft.trim()}@${lat.toFixed(COORD_FIXED)},${lng.toFixed(COORD_FIXED)}`;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const newRecordId = () => uid("rec");
export const newHistoryId = () => uid("his");

// ---------- 核心推演 ----------

export function deriveAll(records: FlightRecord[], now: number = Date.now()): DerivedState {
  const live = records.filter((r) => r.status !== "frozen");

  // 1) 分组键：有效坐标按 鸽棚+坐标；缺坐标归入待复核桶；坏坐标不并组
  const groups = new Map<string, FlightRecord[]>();
  const enrichedBase = new Map<string, { pointId: string | null; key: string | null }>();
  const missingByLoft = new Map<string, number>();

  for (const rec of live) {
    const coord = parseCoord(rec.lat, rec.lng);
    let key: string | null = null;
    let pointId: string | null = null;
    if (coord) {
      key = pointKey(rec.loft, coord.lat, coord.lng);
    } else if (rec.lat.trim() === "" && rec.lng.trim() === "") {
      key = `__NOCOORD__::${rec.loft.trim()}`;
      missingByLoft.set(rec.loft.trim(), (missingByLoft.get(rec.loft.trim()) ?? 0) + 1);
    } else {
      key = `__BADCOORD__::${rec.id}`;
    }
    enrichedBase.set(rec.id, { pointId, key });
    if (key) {
      const arr = groups.get(key) ?? [];
      arr.push(rec);
      groups.set(key, arr);
    }
  }

  // 2) 每个有效坐标组：首次登记定基准（重复只留首次）
  const points: ReleasePoint[] = [];
  const pointByKey = new Map<string, ReleasePoint>();
  const foundingId = new Set<string>();

  const orderByReg = (a: FlightRecord, b: FlightRecord) =>
    Date.parse(a.regAt) - Date.parse(b.regAt) || a.id.localeCompare(b.id);

  for (const [key, arr] of groups) {
    if (key.startsWith("__")) continue;
    const sorted = [...arr].sort(orderByReg);
    const first = sorted[0];
    foundingId.add(first.id);
    const coord = parseCoord(first.lat, first.lng)!;
    const p: ReleasePoint = {
      id: key,
      loft: first.loft.trim(),
      lat: coord.lat,
      lng: coord.lng,
      firstRecordId: first.id,
      anchorAt: parseLocalTime(first.releaseAt) !== null ? first.releaseAt : null,
      baselineKm: first.distanceKm,
      weather: first.weather,
      createdAt: first.regAt,
    };
    points.push(p);
    pointByKey.set(key, p);
    for (const r of arr) enrichedBase.get(r.id)!.pointId = p.id;
  }

  // 3) 逐条核验
  const enriched: EnrichedRecord[] = records.map((rec) => {
    const issues: Issue[] = [];
    const base = enrichedBase.get(rec.id);
    const key = rec.status === "frozen" ? null : base?.key ?? null;
    const point =
      key && !key.startsWith("__") && pointByKey.has(key) ? pointByKey.get(key)! : null;
    const founding = foundingId.has(rec.id);

    if (rec.status !== "frozen") {
      const coord = parseCoord(rec.lat, rec.lng);
      if (!coord) {
        if (rec.lat.trim() === "" && rec.lng.trim() === "") {
          issues.push({ code: "missing-coord", detail: "未填写经纬度" });
        } else {
          issues.push({
            code: "bad-coord",
            detail: "经纬度需为数值（纬度 ±90、经度 ±180）",
          });
        }
      }

      const rel = parseLocalTime(rec.releaseAt);
      const ret = parseLocalTime(rec.returnAt);
      if (rec.releaseAt.trim() !== "" && rel === null) {
        issues.push({ code: "time-invalid", detail: "放飞时刻格式错误" });
      }
      if (rec.returnAt.trim() !== "" && ret === null) {
        issues.push({ code: "time-invalid", detail: "归巢时刻格式错误" });
      }
      if (rel !== null && ret !== null && ret < rel) {
        issues.push({
          code: "time-inverted",
          detail: "归巢时刻早于放飞时刻",
        });
      }
      // 相对锚点：放飞早于该训放点首次放飞
      if (!founding && rel !== null && point?.anchorAt && rel < parseLocalTime(point.anchorAt)!) {
        issues.push({
          code: "time-inverted",
          detail: "放飞时刻早于该训放点首次登记时刻",
        });
      }

      // 距离偏差（首次登记定基准，自身免检）
      if (point && !founding && point.baselineKm !== null) {
        if (rec.distanceKm === null) {
          issues.push({
            code: "distance-missing",
            detail: `基准距离 ${point.baselineKm}km，本条未填距离`,
          });
        } else {
          const diff = Math.abs(rec.distanceKm - point.baselineKm) / point.baselineKm;
          if (diff > DISTANCE_TOLERANCE) {
            issues.push({
              code: "distance-deviation",
              detail: `基准 ${point.baselineKm}km，本条 ${rec.distanceKm}km，偏差 ${(diff * 100).toFixed(1)}%`,
            });
          }
        }
      }
    }

    const rel = parseLocalTime(rec.releaseAt);
    const ret = parseLocalTime(rec.returnAt);
    let durationMin: number | null = null;
    let speed: number | null = null;
    if (
      rel !== null &&
      ret !== null &&
      ret >= rel &&
      rec.distanceKm !== null &&
      rec.distanceKm > 0
    ) {
      durationMin = (ret - rel) / 60000;
      if (durationMin > 0) speed = (rec.distanceKm * 1000) / durationMin;
    }

    return {
      ...rec,
      pointId: rec.status === "frozen" ? null : point?.id ?? null,
      issues,
      founding,
      speed,
      durationMin,
    };
  });

  // 4) 有效集：无任何核验问题的 active 记录（冻结/待复核一律不计）
  const eligible = enriched.filter(
    (r) => r.status === "active" && r.issues.length === 0
  );

  // 排行：已归巢且可算分速
  const ranking: RankingRow[] = eligible
    .filter((r) => r.speed !== null && r.pointId)
    .map((r) => ({
      recordId: r.id,
      ring: r.ring,
      bloodline: r.bloodline,
      pointId: r.pointId!,
      loft: r.loft,
      distanceKm: r.distanceKm!,
      speed: r.speed!,
      durationMin: r.durationMin!,
      returnAt: r.returnAt,
      releaseAt: r.releaseAt,
      weather: r.weather,
    }))
    .sort((a, b) => b.speed - a.speed || Date.parse(a.returnAt) - Date.parse(b.returnAt));

  // 未归巢提醒：有效、已放飞、归巢时刻为空
  const reminders: ReminderRow[] = eligible
    .filter((r) => parseLocalTime(r.releaseAt) !== null && r.returnAt.trim() === "")
    .map((r) => ({
      recordId: r.id,
      ring: r.ring,
      bloodline: r.bloodline,
      loft: r.loft,
      pointId: r.pointId,
      releaseAt: r.releaseAt,
      weather: r.weather,
    }))
    .sort((a, b) => Date.parse(a.releaseAt) - Date.parse(b.releaseAt));

  // 配对候选：至少一条有效成绩，按最佳分速，建议异血搭档
  const byRing = new Map<string, EnrichedRecord[]>();
  for (const r of ranking) {
    const arr = byRing.get(r.ring) ?? [];
    arr.push(enriched.find((e) => e.id === r.recordId)!);
    byRing.set(r.ring, arr);
  }
  const bestOf = new Map<string, CandidateRow>();
  for (const [ring, arr] of byRing) {
    const best = [...arr].sort((a, b) => b.speed! - a.speed!)[0];
    bestOf.set(ring, {
      ring,
      bloodline: best.bloodline,
      bestSpeed: best.speed!,
      flights: arr.length,
      lastReleaseAt: arr
        .map((x) => x.releaseAt)
        .sort()
        .reverse()[0],
      partnerRing: null,
      partnerBloodline: null,
    });
  }
  const candidates = [...bestOf.values()];
  for (const c of candidates) {
    const partner = candidates
      .filter((o) => o.ring !== c.ring && o.bloodline !== c.bloodline)
      .sort((a, b) => b.bestSpeed - a.bestSpeed)[0];
    if (partner) {
      c.partnerRing = partner.ring;
      c.partnerBloodline = partner.bloodline;
    }
  }
  candidates.sort(
    (a, b) =>
      b.bestSpeed - a.bestSpeed ||
      Date.parse(b.lastReleaseAt) - Date.parse(a.lastReleaseAt)
  );

  points.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const missingCoordLofts = [...missingByLoft.entries()]
    .map(([loft, count]) => ({ loft, count }))
    .sort((a, b) => a.loft.localeCompare(b.loft));

  void now;
  return {
    points,
    records: enriched,
    ranking,
    reminders,
    candidates,
    missingCoordLofts,
    counts: {
      total: records.length,
      active: records.filter((r) => r.status === "active").length,
      review: records.filter((r) => r.status === "review").length,
      frozen: records.filter((r) => r.status === "frozen").length,
      returned: eligible.filter((r) => r.returnAt.trim() !== "").length,
      notReturned: reminders.length,
      points: points.length,
    },
  };
}

/** 初登记后的状态判定（无问题即有效，否则只进待复核） */
export function initialStatus(issues: Issue[]): FlightRecord["status"] {
  return issues.length === 0 ? "active" : "review";
}
