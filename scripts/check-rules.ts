import { computeResults, inspectRecord, haversineKm } from "../src/rules";
import type { ArchiveState } from "../src/archive";

// 用内存版 storage 模拟 localStorage
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// archive.ts 顶层 seed() 会在 loadArchive 首次调用时写 localStorage
globalThis.localStorage = memStorage();
const arc = await import("../src/archive");

console.log("1. 示例数据基线");
let state = arc.loadArchive();
const base = computeResults({ lofts: state.lofts, records: state.records });
console.log(`   有效 ${base.activeCount} / 待复核 ${base.reviewCount} / 待复测 ${base.awaitingCount} / 排行 ${base.rankings.length} / 提醒 ${base.reminders.length} / 候选 ${base.pairings.length}`);
check("有三条问题记录（缺坐标/倒置/距离偏差）", base.reviewCount === 3, `got ${base.reviewCount}`);
check("排行只含有效归巢记录", base.rankings.length === 5, `got ${base.rankings.length}`);
check("两条未归巢提醒", base.reminders.length === 2, `got ${base.reminders.length}`);
check("排行按分速降序", base.rankings.every((r, i) => i === 0 || base.rankings[i - 1].speed >= r.speed));
check("待复核足环未出现在排行/提醒/候选", (() => {
  const bad = ["CHN-24-004107", "CHN-23-006622", "CHN-24-005931"];
  const all = [...base.rankings.map(r => r.ring), ...base.reminders.map(r => r.ring), ...base.pairings.map(r => r.ring)];
  return bad.every(b => !all.includes(b));
})());
check("分速量级合理(900~1500)", base.rankings.every(r => r.speed > 900 && r.speed < 1500), `min ${Math.min(...base.rankings.map(r=>r.speed))}`);

console.log("2. 距离实测：棚到点 haversine");
const loft = state.lofts[0];
const actual = haversineKm(loft.coord!, { lat: 39.736, lng: 115.98 });
const dev80 = Math.abs(80 - actual) / actual;
check(`实测距离≈40-43km（got ${actual.toFixed(2)}）`, actual > 40 && actual < 43);
check("登记 80km 偏差 >5%", dev80 > 0.05);
const dev426 = Math.abs(42.6 - actual) / actual;
check("登记 42.6km 偏差 ≤5%", dev426 <= 0.05, `dev ${(dev426*100).toFixed(2)}%`);

console.log("3. 训放点按鸽棚+坐标唯一（重复只留首次）");
const beforePts = state.points.length;
const reg1 = arc.registerRecord(state, {
  loftId: loft.id, ring: "CHN-24-999001", blood: "测试系",
  releaseAt: new Date().toISOString(), homeAt: null,
  coordText: "39.736, 115.98", distanceKm: 42.6, weather: "晴",
});
if ("error" in reg1) throw new Error(reg1.error);
state = reg1.state;
check("同坐标重复不新建训放点", state.points.length === beforePts && reg1.pointReused === true);
const reg2 = arc.registerRecord(state, {
  loftId: loft.id, ring: "CHN-24-999002", blood: "测试系",
  releaseAt: new Date().toISOString(), homeAt: null,
  coordText: "40.50, 115.20", distanceKm: 120, weather: "晴",
});
if ("error" in reg2) throw new Error(reg2.error);
state = reg2.state;
check("新坐标新建训放点", state.points.length === beforePts + 1 && reg2.pointReused === false);

console.log("4. 新登记不合格记录只进待复核");
const badReg = arc.registerRecord(state, {
  loftId: loft.id, ring: "CHN-24-999003", blood: "测试系",
  releaseAt: null, homeAt: null,
  coordText: "", distanceKm: null, weather: "晴",
});
if ("error" in badReg) throw new Error(badReg.error);
state = badReg.state;
const badRec = state.records.find(r => r.id === badReg.recordId)!;
check("缺坐标记录 status=review", inspectRecord(badRec, loft).status === "review");

console.log("5. 更正 → 冻结旧结果 → 待复测 → 两人确认才恢复");
const target = state.records.find(r => r.ring === "CHN-24-004107")!; // 原缺坐标
const beforeRank = computeResults({ lofts: state.lofts, records: state.records });
const corrected = arc.correctRecord(state, target.id, {
  releaseAt: target.releaseAt,
  homeAt: target.homeAt,
  coordText: "39.736, 115.98",
  distanceKm: 42.6,
  reason: "补测坐标",
  by: "张教练",
});
if ("error" in corrected) throw new Error(corrected.error);
state = corrected.state;
check("更正后生成 1 份旧结果快照", state.snapshots.length === 1);
check("快照冻结的是更正前排行", state.snapshots[0].results.rankings.length === beforeRank.rankings.length);
const t1 = state.records.find(r => r.id === target.id)!;
check("更正后状态为待复测确认", inspectRecord(t1, loft).status === "awaiting");
const afterCorrection = computeResults({ lofts: state.lofts, records: state.records });
check("更正后 awaitingCount=1", afterCorrection.awaitingCount === 1);
check("待复测记录仍不进排行", !afterCorrection.rankings.some(r => r.recordId === target.id));

const dupBefore = arc.confirmRecord(state, target.id, "李助理");
if ("error" in dupBefore) throw new Error(dupBefore.error);
const dupConfirm = arc.confirmRecord(dupBefore.state, target.id, "李助理");
check("同名复核人被拒绝（同一人不能重复）", "error" in dupConfirm);
state = dupBefore.state;

const c1 = arc.confirmRecord(state, target.id, "王兽医");
if ("error" in c1) throw new Error(c1.error);
state = c1.state;
check("两人不同确认后恢复", c1.restored === true);
const restored = computeResults({ lofts: state.lofts, records: state.records });
const t2 = state.records.find(r => r.id === target.id)!;
check("恢复后记录状态 active", inspectRecord(t2, loft).status === "active");
check("恢复后重新进入排行", restored.rankings.some(r => r.recordId === target.id));
check("快照旧结果不受后续重算影响（旧排行仍缺该羽）",
  !state.snapshots[0].results.rankings.some(r => r.recordId === target.id));

console.log("6. 两人复测后仍不合格 → 退回待复核，不恢复排行");
const inv = state.records.find(r => r.ring === "CHN-23-006622")!; // 时间倒置
const invCorr = arc.correctRecord(state, inv.id, {
  releaseAt: inv.releaseAt, homeAt: inv.homeAt, // 仍倒置
  coordText: "39.736, 115.98", distanceKm: 42.6,
  reason: "只改坐标", by: "张教练",
});
if ("error" in invCorr) throw new Error(invCorr.error);
state = invCorr.state;
const step1 = arc.confirmRecord(state, inv.id, "李助理");
if ("error" in step1) throw new Error(step1.error);
const step2 = arc.confirmRecord(step1.state, inv.id, "王兽医");
if ("error" in step2) throw new Error(step2.error);
state = step2.state;
const invRec = state.records.find(r => r.id === inv.id)!;
check("两人确认后因时间仍倒置 → review", inspectRecord(invRec, loft).status === "review");
const resInv = computeResults({ lofts: state.lofts, records: state.records });
check("仍不进排行", !resInv.rankings.some(r => r.recordId === inv.id));

console.log("7. 血统筛选只影响有效派生结果");
const js = computeResults({ lofts: state.lofts, records: state.records, blood: "詹森系" });
check("血统筛选后排行全为詹森系", js.rankings.every(r => r.blood === "詹森系"));
check("筛选后候选全为詹森系", js.pairings.every(r => r.blood === "詹森系"));

console.log("8. 刷新后状态一致（重新 loadArchive）");
const reloaded = arc.loadArchive();
const relRes = computeResults({ lofts: reloaded.lofts, records: reloaded.records });
const curRes = computeResults({ lofts: state.lofts, records: state.records });
check("重载后记录条数一致", reloaded.records.length === state.records.length);
check("重载后排行条数一致", relRes.rankings.length === curRes.rankings.length);
check("重载后快照数一致", reloaded.snapshots.length === state.snapshots.length);
check("重载后确认人保留", reloaded.records.find(r => r.id === target.id)?.confirmations.length === 2);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
