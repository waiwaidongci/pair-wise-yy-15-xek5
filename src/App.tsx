// ============================================================
// 业务文件 3：界面层（App.tsx）
// 离线赛鸽训放坐标核验台。所有视图都从同一份档案 + 同一套规则
// 派生数据，刷新后从 localStorage 恢复，各处状态天然一致。
// ============================================================

import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  addLoft,
  bloodLines,
  clearArchive,
  confirmRecord,
  correctRecord,
  getResults,
  loadArchive,
  markHome,
  parseCoordText,
  registerRecord,
  resetArchive,
  ArchiveState,
} from "./archive";
import {
  DISTANCE_TOLERANCE,
  formatDuration,
  formatKm,
  formatSpeed,
  inspectRecord,
  ISSUE_TEXT,
  REQUIRED_RECHECKS,
  TrainingRecord,
} from "./rules";

type Tab =
  | "overview"
  | "register"
  | "ranking"
  | "reminders"
  | "pairing"
  | "review"
  | "profile"
  | "snapshots";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "鸽棚总览" },
  { key: "register", label: "训放登记" },
  { key: "ranking", label: "成绩排行" },
  { key: "reminders", label: "未归巢提醒" },
  { key: "pairing", label: "配对候选" },
  { key: "review", label: "待复核" },
  { key: "profile", label: "单羽档案" },
  { key: "snapshots", label: "旧结果" },
];

// ---------------- 时间/表单工具 ----------------

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function coordText(r: TrainingRecord): string {
  return r.coord ? `${r.coord.lat}, ${r.coord.lng}` : "";
}

// ---------------- 主组件 ----------------

export default function App() {
  const [state, setState] = useState<ArchiveState>(() => loadArchive());
  const [tab, setTab] = useState<Tab>("overview");
  const [loftId, setLoftId] = useState<string>("all");
  const [blood, setBlood] = useState<string>("");
  const [now, setNow] = useState<number>(() => Date.now());
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 未归巢滞留时长每 30 秒刷新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  const lofts = state.lofts;
  const loftMap = useMemo(() => new Map(lofts.map((l) => [l.id, l])), [lofts]);

  // 同一入口派生排行/提醒/配对——所有视图共用，保证一致
  const scopedRecords = useMemo(
    () =>
      loftId === "all"
        ? state.records
        : state.records.filter((r) => r.loftId === loftId),
    [state.records, loftId],
  );
  const results = useMemo(
    () => getResults({ ...state, records: scopedRecords }, blood || null, now),
    [state, scopedRecords, blood, now],
  );

  // 全部记录的逐行核验（待复核页、档案页共用）
  const inspections = useMemo(() => {
    const m = new Map<string, ReturnType<typeof inspectRecord>>();
    for (const r of state.records) {
      m.set(r.id, inspectRecord(r, loftMap.get(r.loftId)));
    }
    return m;
  }, [state.records, loftMap]);

  const reviewRecords = state.records.filter(
    (r) => inspections.get(r.id)!.status !== "active",
  );

  const notify = (kind: "ok" | "err", text: string) => setToast({ kind, text });

  const finished = results.rankings.length;
  const releasedActive = finished + results.reminders.length;
  const homeRatePct = releasedActive ? (finished / releasedActive) * 100 : 0;
  const avgSpeed = finished
    ? results.rankings.reduce((s, r) => s + r.speed, 0) / finished
    : 0;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="kicker">离线 · localStorage · 规则 / 档案 / 界面 三文件分离</p>
          <h1>赛鸽训放坐标核验台</h1>
          <span className="sub">
            坐标缺失、时间倒置、距离偏差超 {DISTANCE_TOLERANCE * 100}% 只进待复核；
            更正后须 {REQUIRED_RECHECKS} 人复测确认才恢复排行。
          </span>
        </div>
        <div className="top-actions">
          <button
            onClick={() => {
              if (confirm("恢复为内置示例数据？当前档案将被覆盖。")) {
                setState(resetArchive());
                notify("ok", "已恢复示例数据");
              }
            }}
          >
            示例数据
          </button>
          <button
            onClick={() => {
              if (confirm("确定清空全部档案？此操作不可恢复。")) {
                setState(clearArchive());
                notify("ok", "档案已清空");
              }
            }}
          >
            清空档案
          </button>
        </div>
      </header>

      <section className="metrics">
        <Metric label="有效训放记录" value={String(results.activeCount)} tone="primary" />
        <Metric label="归巢率" value={`${homeRatePct.toFixed(0)}%`} tone="primary" />
        <Metric label="平均分速" value={avgSpeed ? formatSpeed(avgSpeed) : "—"} tone="primary" />
        <Metric label="未归巢" value={String(results.reminders.length)} tone="accent" />
        <Metric label="待复核" value={String(results.reviewCount)} tone="warn" />
        <Metric label="待复测确认" value={String(results.awaitingCount)} tone="muted" />
      </section>

      <section className="workspace">
        <aside className="panel nav-panel">
          <nav className="nav">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? "nav-item active" : "nav-item"}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {t.key === "review" && reviewRecords.length > 0 && (
                  <em className="badge">{reviewRecords.length}</em>
                )}
                {t.key === "snapshots" && state.snapshots.length > 0 && (
                  <em className="badge muted-badge">{state.snapshots.length}</em>
                )}
              </button>
            ))}
          </nav>

          <div className="filter-block">
            <p>范围筛选</p>
            <label>
              <span>鸽棚</span>
              <select value={loftId} onChange={(e) => setLoftId(e.target.value)}>
                <option value="all">全部鸽棚</option>
                {lofts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>血统</span>
              <select value={blood} onChange={(e) => setBlood(e.target.value)}>
                <option value="">全部血统</option>
                {bloodLines(state).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <p className="filter-hint">
              排行、提醒、配对候选、档案均按当前鸽棚与血统实时重算。
            </p>
          </div>
        </aside>

        <section className="panel content-panel">
          {tab === "overview" && (
            <Overview
              state={state}
              results={results}
              onAddLoft={(name, c) => {
                const r = addLoft(state, name, c);
                setState(r.state);
                setLoftId(r.loftId);
                notify("ok", `鸽棚「${name}」已建档`);
              }}
            />
          )}

          {tab === "register" && (
            <RegisterForm
              state={state}
              fixedLoft={loftId !== "all" ? loftId : ""}
              onSubmit={(input) => {
                const r = registerRecord(state, input);
                if ("error" in r) {
                  notify("err", r.error);
                  return;
                }
                setState(r.state);
                notify(
                  "ok",
                  r.pointReused
                    ? "登记成功；该训放点已存在，沿用首次建档"
                    : "登记成功；新训放点已按鸽棚+坐标建档",
                );
              }}
            />
          )}

          {tab === "ranking" && <Ranking state={state} results={results} />}

          {tab === "reminders" && (
            <Reminders
              state={state}
              results={results}
              onHome={(id) => {
                const r = markHome(state, id, new Date().toISOString());
                if ("error" in r) notify("err", r.error);
                else {
                  setState(r.state);
                  notify("ok", "已标记归巢，排行已重算");
                }
              }}
            />
          )}

          {tab === "pairing" && <Pairing state={state} results={results} />}

          {tab === "review" && (
            <ReviewQueue
              state={state}
              inspections={inspections}
              onCorrect={(id, input) => {
                const r = correctRecord(state, id, input);
                if ("error" in r) {
                  notify("err", r.error);
                  return;
                }
                setState(r.state);
                notify("ok", "已更正并冻结旧结果；记录等待两人复测确认");
              }}
              onConfirm={(id, name) => {
                const r = confirmRecord(state, id, name);
                if ("error" in r) {
                  notify("err", r.error);
                  return;
                }
                setState(r.state);
                notify(
                  "ok",
                  r.restored
                    ? "两人复测完成，记录恢复有效，排行/提醒/配对已重算"
                    : "复测已记录，还差一名不同复核人",
                );
              }}
            />
          )}

          {tab === "profile" && (
            <Profile state={state} inspections={inspections} now={now} />
          )}

          {tab === "snapshots" && <Snapshots state={state} />}
        </section>
      </section>

      {toast && (
        <div className={toast.kind === "ok" ? "toast ok" : "toast err"}>
          {toast.text}
        </div>
      )}
      <footer className="foot">
        数据仅保存在本机浏览器，离线可用；刷新页面后各视图状态一致。
      </footer>
    </main>
  );
}

// ---------------- 通用小组件 ----------------

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article className={`metric tone-${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function StatusBadge({ status }: { status: "active" | "review" | "awaiting" }) {
  const map = {
    active: ["有效", "badge-active"],
    review: ["待复核", "badge-review"],
    awaiting: ["待复测", "badge-awaiting"],
  } as const;
  const [text, cls] = map[status];
  return <span className={`status ${cls}`}>{text}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">— {text} —</div>;
}

function LoftName({ state, id }: { state: ArchiveState; id: string }) {
  return <>{state.lofts.find((l) => l.id === id)?.name ?? id}</>;
}

// ---------------- 总览 ----------------

function Overview({
  state,
  results,
  onAddLoft,
}: {
  state: ArchiveState;
  results: ReturnType<typeof getResults>;
  onAddLoft: (name: string, coord: ReturnType<typeof parseCoordText>) => void;
}) {
  const [name, setName] = useState("");
  const [coord, setCoord] = useState("");

  // 训放点使用次数
  const pointUse = new Map<string, number>();
  for (const r of state.records) {
    if (!r.coord) continue;
    const key = `${r.loftId}|${r.coord.lat}|${r.coord.lng}`;
    pointUse.set(key, (pointUse.get(key) ?? 0) + 1);
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">鸽棚总览</p>
          <h2>鸽棚与训放点</h2>
        </div>
      </div>

      <div className="loft-grid">
        {state.lofts.length === 0 && <Empty text="尚无鸽棚，请先在下方建档" />}
        {state.lofts.map((l) => {
          const count = state.records.filter((r) => r.loftId === l.id).length;
          const pts = new Set(
            state.records
              .filter((r) => r.loftId === l.id && r.coord)
              .map((r) => `${r.coord!.lat}|${r.coord!.lng}`),
          ).size;
          return (
            <article key={l.id} className="loft-card">
              <h3>{l.name}</h3>
              <p>棚坐标：{l.coord ? `${l.coord.lat}, ${l.coord.lng}` : "未设置（无法核验距离）"}</p>
              <p>训放记录：{count} 条 · 唯一训放点：{pts} 个</p>
            </article>
          );
        })}
      </div>

      <div className="sub-head">
        <h3>训放点台账（按鸽棚 + 坐标唯一，重复只留首次）</h3>
      </div>
      {state.points.length === 0 ? (
        <Empty text="尚无有效坐标的训放记录" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>训放点坐标</th>
              <th>所属鸽棚</th>
              <th>首次登记</th>
              <th>首录足环</th>
              <th>累计训放</th>
            </tr>
          </thead>
          <tbody>
            {state.points.map((p) => (
              <tr key={p.key}>
                <td className="mono">{p.coord.lat}, {p.coord.lng}</td>
                <td>{state.lofts.find((l) => l.id === p.loftId)?.name ?? p.loftId}</td>
                <td>{fmtDT(p.firstSeen)}</td>
                <td className="mono">
                  {state.records.find((r) => r.id === p.firstRecordId)?.ring ?? p.firstRecordId}
                </td>
                <td>{pointUse.get(p.key) ?? 1} 次</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="sub-head"><h3>新增鸽棚</h3></div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const c = coord.trim() ? parseCoordText(coord) : null;
          if (coord.trim() && !c) {
            alert("棚坐标格式应为「纬度,经度」");
            return;
          }
          onAddLoft(name, c);
          setName("");
          setCoord("");
        }}
      >
        <input placeholder="鸽棚名称，如：北辰公棚" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="棚坐标 纬度,经度（用于距离核验）" value={coord} onChange={(e) => setCoord(e.target.value)} />
        <button className="primary" type="submit">建档</button>
      </form>

      <div className="rule-note">
        当前范围：有效 {results.activeCount} 条 · 待复核 {results.reviewCount} 条 ·
        待复测 {results.awaitingCount} 条；待复核记录不计入排行、提醒与配对候选。
      </div>
    </div>
  );
}

// ---------------- 登记 ----------------

function RegisterForm({
  state,
  fixedLoft,
  onSubmit,
}: {
  state: ArchiveState;
  fixedLoft: string;
  onSubmit: (input: Parameters<typeof registerRecord>[1]) => void;
}) {
  const [loftId, setLoftId] = useState(fixedLoft || state.lofts[0]?.id || "");
  const [ring, setRing] = useState("");
  const [blood, setBlood] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [homeAt, setHomeAt] = useState("");
  const [coord, setCoord] = useState("");
  const [distance, setDistance] = useState("");
  const [weather, setWeather] = useState("晴");

  useEffect(() => {
    if (fixedLoft) setLoftId(fixedLoft);
  }, [fixedLoft]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      loftId,
      ring,
      blood,
      releaseAt: fromLocalInput(releaseAt),
      homeAt: fromLocalInput(homeAt),
      coordText: coord,
      distanceKm: distance ? Number(distance) : null,
      weather,
    });
  };

  if (state.lofts.length === 0) {
    return <Empty text="请先到「鸽棚总览」建立鸽棚" />;
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">训放登记</p>
          <h2>足环 · 血统 · 时刻 · 坐标 · 距离 · 天气</h2>
        </div>
      </div>
      <form className="reg-form" onSubmit={submit}>
        <label>
          <span>鸽棚 *</span>
          <select value={loftId} onChange={(e) => setLoftId(e.target.value)}>
            {state.lofts.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>足环号 *</span>
          <input placeholder="CHN-24-001839" value={ring} onChange={(e) => setRing(e.target.value)} />
        </label>
        <label>
          <span>血统 *</span>
          <input list="blood-list" placeholder="詹森系" value={blood} onChange={(e) => setBlood(e.target.value)} />
          <datalist id="blood-list">
            {bloodLines(state).map((b) => <option key={b} value={b} />)}
          </datalist>
        </label>
        <label>
          <span>天气</span>
          <input placeholder="晴 / 小雨 / 侧风" value={weather} onChange={(e) => setWeather(e.target.value)} />
        </label>
        <label>
          <span>放飞时刻</span>
          <input type="datetime-local" value={releaseAt} onChange={(e) => setReleaseAt(e.target.value)} />
        </label>
        <label>
          <span>归巢时刻（未归巢留空）</span>
          <input type="datetime-local" value={homeAt} onChange={(e) => setHomeAt(e.target.value)} />
        </label>
        <label>
          <span>训放点坐标（纬度,经度）</span>
          <input placeholder="39.736, 115.98" value={coord} onChange={(e) => setCoord(e.target.value)} />
        </label>
        <label>
          <span>登记距离（公里）</span>
          <input type="number" step="0.1" min="0" placeholder="42.6" value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
        <div className="form-actions">
          <button className="primary" type="submit">提交登记</button>
        </div>
      </form>
      <div className="rule-note">
        核验规则：坐标缺失、归巢早于放飞、登记距离与棚坐标实测大圆距离偏差超 {DISTANCE_TOLERANCE * 100}%
        的记录只进「待复核」，不计排行、未归巢提醒与配对候选。
      </div>
    </div>
  );
}

// ---------------- 排行 ----------------

function Ranking({ state, results }: { state: ArchiveState; results: ReturnType<typeof getResults> }) {
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">训放成绩排行（按分速降序）</p>
          <h2>成绩排行</h2>
        </div>
        <span className="gen-at">重算于 {fmtDT(results.generatedAt)}</span>
      </div>
      {results.rankings.length === 0 ? (
        <Empty text="当前筛选下没有有效归巢成绩" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名次</th><th>足环</th><th>血统</th><th>鸽棚</th>
              <th>距离</th><th>放飞</th><th>归巢</th><th>飞行时长</th>
              <th>分速</th><th>天气</th>
            </tr>
          </thead>
          <tbody>
            {results.rankings.map((r, i) => (
              <tr key={r.recordId} className={i < 3 ? `rank-${i + 1}` : ""}>
                <td><b>{i + 1}</b></td>
                <td className="mono">{r.ring}</td>
                <td>{r.blood}</td>
                <td><LoftName state={state} id={r.loftId} /></td>
                <td>{formatKm(r.distanceKm)}</td>
                <td>{fmtDT(r.releaseAt)}</td>
                <td>{fmtDT(r.homeAt)}</td>
                <td>{formatDuration(r.flightMin)}</td>
                <td className="strong-cell">{formatSpeed(r.speed)}</td>
                <td>{r.weather}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------- 未归巢提醒 ----------------

function Reminders({
  state,
  results,
  onHome,
}: {
  state: ArchiveState;
  results: ReturnType<typeof getResults>;
  onHome: (id: string) => void;
}) {
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">仅统计有效记录；滞留越久越靠前</p>
          <h2>未归巢提醒</h2>
        </div>
      </div>
      {results.reminders.length === 0 ? (
        <Empty text="当前筛选下没有未归巢赛鸽" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>足环</th><th>血统</th><th>鸽棚</th><th>放飞时刻</th>
              <th>已滞留</th><th>天气</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {results.reminders.map((r) => (
              <tr key={r.recordId}>
                <td className="mono">{r.ring}</td>
                <td>{r.blood}</td>
                <td><LoftName state={state} id={r.loftId} /></td>
                <td>{fmtDT(r.releaseAt)}</td>
                <td className="strong-cell warn-text">{formatDuration(r.elapsedMin)}</td>
                <td>{r.weather}</td>
                <td>
                  <button onClick={() => onHome(r.recordId)}>标记归巢</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------- 配对候选 ----------------

function Pairing({ state, results }: { state: ArchiveState; results: ReturnType<typeof getResults> }) {
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">按足环汇总有效成绩，至少一羽有效归巢</p>
          <h2>配对候选</h2>
        </div>
      </div>
      {results.pairings.length === 0 ? (
        <Empty text="当前筛选下暂无配对候选" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>足环</th><th>血统</th><th>鸽棚</th><th>有效归巢</th>
              <th>归巢率</th><th>平均分速</th><th>最佳分速</th><th>最近归巢</th>
            </tr>
          </thead>
          <tbody>
            {results.pairings.map((p) => (
              <tr key={`${p.loftId}-${p.ring}`}>
                <td className="mono">{p.ring}</td>
                <td>{p.blood}</td>
                <td><LoftName state={state} id={p.loftId} /></td>
                <td>{p.finishes} 次</td>
                <td>{(p.homeRate * 100).toFixed(0)}%</td>
                <td className="strong-cell">{formatSpeed(p.avgSpeed)}</td>
                <td>{formatSpeed(p.bestSpeed)}</td>
                <td>{fmtDT(p.lastHomeAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------- 待复核 / 更正 / 两人复测 ----------------

function ReviewQueue({
  state,
  inspections,
  onCorrect,
  onConfirm,
}: {
  state: ArchiveState;
  inspections: Map<string, ReturnType<typeof inspectRecord>>;
  onCorrect: (id: string, input: Parameters<typeof correctRecord>[2]) => void;
  onConfirm: (id: string, reviewer: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const rows = state.records
    .filter((r) => inspections.get(r.id)!.status !== "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">坐标缺失 / 时间倒置 / 距离偏差超 5% 只进这里</p>
          <h2>待复核与复测确认</h2>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty text="没有待复核记录" />
      ) : (
        <div className="review-list">
          {rows.map((r) => (
            <ReviewCard
              key={r.id}
              state={state}
              record={r}
              expanded={editing === r.id}
              onToggleEdit={() => setEditing(editing === r.id ? null : r.id)}
              onCorrect={(input) => {
                onCorrect(r.id, input);
                setEditing(null);
              }}
              onConfirm={(name) => onConfirm(r.id, name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  state,
  record,
  expanded,
  onToggleEdit,
  onCorrect,
  onConfirm,
}: {
  state: ArchiveState;
  record: TrainingRecord;
  expanded: boolean;
  onToggleEdit: () => void;
  onCorrect: (input: Parameters<typeof correctRecord>[2]) => void;
  onConfirm: (reviewer: string) => void;
}) {
  const insp = inspectRecord(record, state.lofts.find((l) => l.id === record.loftId));
  const [releaseAt, setReleaseAt] = useState(toLocalInput(record.releaseAt));
  const [homeAt, setHomeAt] = useState(toLocalInput(record.homeAt));
  const [coord, setCoord] = useState(coordText(record));
  const [distance, setDistance] = useState(
    record.distanceKm != null ? String(record.distanceKm) : "",
  );
  const [reason, setReason] = useState("");
  const [operator, setOperator] = useState("");
  const [reviewer, setReviewer] = useState("");

  return (
    <article className={`review-card ${insp.status === "awaiting" ? "is-awaiting" : ""}`}>
      <div className="review-head">
        <div>
          <h3 className="mono">{record.ring}</h3>
          <p className="review-meta">
            {record.blood} · <LoftName state={state} id={record.loftId} /> · 天气 {record.weather}
          </p>
        </div>
        <StatusBadge status={insp.status} />
      </div>

      <div className="review-grid">
        <div><span>放飞</span>{fmtDT(record.releaseAt)}</div>
        <div><span>归巢</span>{fmtDT(record.homeAt)}</div>
        <div><span>坐标</span>{coordText(record) || "缺失"}</div>
        <div>
          <span>距离</span>
          登记 {formatKm(record.distanceKm)}
          {insp.actualKm != null && <> · 实测 {formatKm(insp.actualKm)}</>}
        </div>
      </div>

      <ul className="issue-list">
        {insp.issues.map((iss) => (
          <li key={iss.kind} className={`issue issue-${iss.kind}`}>
            <b>{ISSUE_TEXT[iss.kind]}</b>：{iss.message}
          </li>
        ))}
        {insp.status === "awaiting" && (
          <li className="issue issue-awaiting">
            已于 {fmtDT(record.correction?.at)} 由 {record.correction?.by} 更正
            （{record.correction?.fields.join("、")}）：{record.correction?.reason}
          </li>
        )}
      </ul>

      {insp.status === "awaiting" && (
        <div className="confirm-box">
          <div className="confirm-chips">
            <span className="confirm-label">复测确认（需 {REQUIRED_RECHECKS} 名不同复核人）：</span>
            {record.confirmations.length === 0 && <span className="chip-empty">尚无人确认</span>}
            {record.confirmations.map((c) => (
              <span key={c} className="chip">{c} ✓</span>
            ))}
          </div>
          <div className="inline-form">
            <input
              placeholder="复核人姓名"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => {
                if (!reviewer.trim()) return;
                onConfirm(reviewer);
                setReviewer("");
              }}
            >
              提交复测确认
            </button>
          </div>
        </div>
      )}

      {insp.status === "review" && (
        <>
          <button className="link-btn" onClick={onToggleEdit}>
            {expanded ? "收起更正" : "更正坐标 / 时刻"}
          </button>
          {expanded && (
            <form
              className="reg-form compact"
              onSubmit={(e) => {
                e.preventDefault();
                onCorrect({
                  releaseAt: fromLocalInput(releaseAt),
                  homeAt: fromLocalInput(homeAt),
                  coordText: coord,
                  distanceKm: distance ? Number(distance) : null,
                  reason,
                  by: operator,
                });
              }}
            >
              <label>
                <span>放飞时刻</span>
                <input type="datetime-local" value={releaseAt} onChange={(e) => setReleaseAt(e.target.value)} />
              </label>
              <label>
                <span>归巢时刻</span>
                <input type="datetime-local" value={homeAt} onChange={(e) => setHomeAt(e.target.value)} />
              </label>
              <label>
                <span>训放点坐标</span>
                <input value={coord} onChange={(e) => setCoord(e.target.value)} placeholder="纬度,经度" />
              </label>
              <label>
                <span>登记距离（公里）</span>
                <input type="number" step="0.1" min="0" value={distance} onChange={(e) => setDistance(e.target.value)} />
              </label>
              <label className="wide">
                <span>更正原因</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：现场复测坐标有误" />
              </label>
              <label>
                <span>更正操作人 *</span>
                <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="姓名" />
              </label>
              <div className="form-actions">
                <button className="primary" type="submit">提交更正并冻结旧结果</button>
              </div>
            </form>
          )}
        </>
      )}
    </article>
  );
}

// ---------------- 单羽档案 ----------------

function Profile({
  state,
  inspections,
  now,
}: {
  state: ArchiveState;
  inspections: Map<string, ReturnType<typeof inspectRecord>>;
  now: number;
}) {
  const rings = useMemo(() => {
    const map = new Map<string, { blood: string; loftId: string }>();
    for (const r of state.records) {
      if (!map.has(r.ring)) map.set(r.ring, { blood: r.blood, loftId: r.loftId });
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.records]);

  const [ring, setRing] = useState(rings[0]?.[0] ?? "");
  useEffect(() => {
    if (!rings.some(([r]) => r === ring)) setRing(rings[0]?.[0] ?? "");
  }, [rings, ring]);

  const history = state.records
    .filter((r) => r.ring === ring)
    .sort((a, b) => (b.releaseAt ?? b.createdAt).localeCompare(a.releaseAt ?? a.createdAt));

  // 单羽统计只算有效记录（与配对候选同口径）
  const valid = history.filter((r) => inspections.get(r.id)!.status === "active");
  const finishedCount = valid.filter((r) => r.homeAt).length;
  const speeds = valid
    .filter((r) => r.homeAt && r.releaseAt && r.distanceKm != null)
    .map((r) => {
      const min = (Date.parse(r.homeAt!) - Date.parse(r.releaseAt!)) / 60000;
      return min > 0 ? (r.distanceKm! * 1000) / min : 0;
    })
    .filter((s) => s > 0);
  const outside = valid.filter((r) => !r.homeAt).length;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">单羽赛鸽档案</p>
          <h2>足环档案与历史成绩</h2>
        </div>
        <select className="ring-select" value={ring} onChange={(e) => setRing(e.target.value)}>
          {rings.map(([r, info]) => (
            <option key={r} value={r}>{r}（{info.blood}）</option>
          ))}
        </select>
      </div>

      {history.length === 0 ? (
        <Empty text="暂无档案，请先登记" />
      ) : (
        <>
          <div className="metrics profile-metrics">
            <Metric label="血统" value={history[0].blood} tone="primary" />
            <Metric label="所属鸽棚" value={state.lofts.find((l) => l.id === history[0].loftId)?.name ?? "—"} tone="muted" />
            <Metric label="有效归巢" value={`${finishedCount} 次`} tone="primary" />
            <Metric label="归巢率" value={valid.length ? `${((finishedCount / valid.length) * 100).toFixed(0)}%` : "—"} tone="primary" />
            <Metric label="平均分速" value={speeds.length ? formatSpeed(speeds.reduce((a, b) => a + b, 0) / speeds.length) : "—"} tone="primary" />
            <Metric label="在外未归" value={String(outside)} tone="accent" />
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>放飞</th><th>归巢</th><th>坐标</th><th>距离</th>
                <th>天气</th><th>状态</th><th>问题</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const insp = inspections.get(r.id)!;
                const releaseTs = r.releaseAt ? Date.parse(r.releaseAt) : NaN;
                const flightNote = r.homeAt
                  ? Number.isFinite(releaseTs)
                    ? formatDuration((Date.parse(r.homeAt) - releaseTs) / 60000)
                    : ""
                  : Number.isFinite(releaseTs)
                    ? `未归巢 · 已滞留 ${formatDuration((now - releaseTs) / 60000)}`
                    : "未归巢";
                return (
                  <tr key={r.id}>
                    <td>{fmtDT(r.releaseAt)}</td>
                    <td>{fmtDT(r.homeAt)} <small className="dim">{flightNote}</small></td>
                    <td className="mono">{coordText(r) || "缺失"}</td>
                    <td>{formatKm(r.distanceKm)}</td>
                    <td>{r.weather}</td>
                    <td><StatusBadge status={insp.status} /></td>
                    <td className="issue-cell">
                      {insp.issues.map((i) => ISSUE_TEXT[i.kind]).join("、") ||
                        (insp.status === "awaiting" ? "等待两人复测" : "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------------- 旧结果快照 ----------------

function Snapshots({ state }: { state: ArchiveState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const snaps = [...state.snapshots].sort((a, b) => b.version - a.version);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="kicker">更正坐标/时刻时自动冻结；排行失效重算，旧结果可查</p>
          <h2>旧结果归档</h2>
        </div>
      </div>
      {snaps.length === 0 ? (
        <Empty text="尚无更正，暂无旧结果" />
      ) : (
        <div className="snapshot-list">
          {snaps.map((s) => {
            const rec = state.records.find((r) => r.id === s.changedRecordId);
            const open = openId === s.id;
            return (
              <article key={s.id} className="snapshot-card">
                <button className="snapshot-head" onClick={() => setOpenId(open ? null : s.id)}>
                  <div>
                    <h3>v{s.version} · {rec?.ring ?? s.changedRecordId}（{rec?.blood}）</h3>
                    <p>
                      {fmtDT(s.at)} · {s.by} 更正「{s.reason}」
                    </p>
                  </div>
                  <span className="snapshot-stats">
                    旧有效 {s.results.activeCount} · 旧排行 {s.results.rankings.length} ·
                    旧提醒 {s.results.reminders.length} · 旧候选 {s.results.pairings.length}
                    <b className="caret">{open ? "▾" : "▸"}</b>
                  </span>
                </button>
                {open && (
                  <div className="snapshot-body">
                    <p className="dim">以下为更正发生前的冻结排行，不随后续操作变化：</p>
                    {s.results.rankings.length === 0 ? (
                      <Empty text="该版本无有效排行" />
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>名次</th><th>足环</th><th>血统</th><th>距离</th>
                            <th>飞行时长</th><th>分速</th><th>归巢时刻</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.results.rankings.map((r, i) => (
                            <tr key={r.recordId}>
                              <td>{i + 1}</td>
                              <td className="mono">{r.ring}</td>
                              <td>{r.blood}</td>
                              <td>{formatKm(r.distanceKm)}</td>
                              <td>{formatDuration(r.flightMin)}</td>
                              <td>{formatSpeed(r.speed)}</td>
                              <td>{fmtDT(r.homeAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
