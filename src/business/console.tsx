/**
 * 业务文件三 · 界面（离线核验台控制台）
 * ----------------------------------
 * 只负责交互与展示：所有规则判定调用 rules.ts，所有存档/工作流调用 archive.ts。
 * 单一派生状态 deriveAll(records) 驱动全部视图，更正后统一重算，刷新后仍一致。
 */

import { useEffect, useMemo, useState } from "react";
import {
  deriveAll,
  EnrichedRecord,
  ISSUE_TEXT,
  Issue,
  RankingRow,
} from "./rules";
import {
  addRecord,
  confirmRetest,
  correctRecord,
  formatDateTime,
  loadStore,
  patchProfile,
  RecordInput,
  resetStore,
  Store,
  VerifiablePatch,
} from "./archive";

type Tab =
  | "overview"
  | "register"
  | "ranking"
  | "reminders"
  | "review"
  | "retest"
  | "profile"
  | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "鸽棚总览" },
  { id: "register", label: "登记训放" },
  { id: "ranking", label: "成绩排行" },
  { id: "reminders", label: "未归巢提醒" },
  { id: "review", label: "待复核" },
  { id: "retest", label: "复测确认" },
  { id: "profile", label: "赛鸽档案" },
  { id: "history", label: "旧结果留档" },
];

function emptyForm(): RecordInput {
  return {
    ring: "",
    bloodline: "",
    loft: "",
    lat: "",
    lng: "",
    releaseAt: "",
    returnAt: "",
    distanceKm: null,
    weather: "",
    note: "",
  };
}

export default function Console() {
  const [store, setStore] = useState<Store>(() => loadStore());
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("pigeon-loft-archive")) {
        setStore(loadStore());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const derived = useMemo(() => deriveAll(store.records), [store.records]);
  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3600);
  };

  const goto = (t: Tab) => setTab(t);

  const handleAdd = (input: RecordInput) => {
    const res = addRecord(store, input);
    setStore(res.store);
    if (res.duplicate) {
      flash("重复登记已拒绝：同足环 / 同训放点 / 同放飞时刻，按规则只留首次。");
    } else if (res.issues.length > 0) {
      flash("已登记，但触发核验规则，只进待复核，暂不计排行 / 提醒 / 配对候选。");
      setTab("review");
    } else {
      flash("登记成功，核验通过，已计入排行 / 提醒 / 配对候选。");
      setTab("overview");
    }
  };

  const handleCorrect = (
    id: string,
    patch: VerifiablePatch,
    by: string,
    reason: string
  ) => {
    const res = correctRecord(store, id, patch, by, reason);
    if ("error" in res) {
      flash(res.error);
      return false;
    }
    setStore(res.store);
    flash("已更正：排行 / 提醒 / 血统筛选失效并以更正后数据重算；旧结果已留档，等待两人复测。");
    return true;
  };

  const handleConfirm = (id: string, name: string) => {
    const res = confirmRetest(store, id, name);
    if ("error" in res) {
      flash(res.error);
      return;
    }
    setStore(res.store);
    if (res.restored) {
      flash(
        res.issues.length === 0
          ? "两人复测完成，记录恢复，重新计入排行 / 提醒 / 配对候选。"
          : "两人复测完成，但仍有核验问题，记录回到待复核队列。"
      );
    } else {
      flash("已记录第 1 位复测人，还需第 2 位（不能是更正人本人）确认。");
    }
  };

  const handleProfilePatch = (
    id: string,
    patch: Partial<{ bloodline: string; weather: string; note: string }>
  ) => {
    setStore(patchProfile(store, id, patch));
    flash("档案信息已更新（不影响坐标核验）。");
  };

  const handleReset = () => {
    if (window.confirm("确定清空本机全部档案并恢复示例数据？此操作不可撤销。")) {
      setStore(resetStore(store));
      flash("已重置为示例档案。");
    }
  };

  const reviewCount = derived.counts.review;
  const frozenCount = derived.counts.frozen;

  return (
    <div className="console">
      <header className="topbar">
        <div>
          <h1>赛鸽训放坐标核验台</h1>
          <p className="sub">离线存档 · 训放点按「鸽棚 + 坐标」唯一 · 坐标缺失 / 时间倒置 / 距离偏差 &gt;5% 只进待复核</p>
        </div>
        <div className="top-actions">
          <span className="savedot" title="数据保存在本机浏览器" />
          <button className="ghost" onClick={handleReset}>重置示例数据</button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={"tab" + (tab === t.id ? " active" : "")}
            onClick={() => goto(t.id)}
          >
            {t.label}
            {t.id === "review" && reviewCount > 0 && <em className="badge warn">{reviewCount}</em>}
            {t.id === "retest" && frozenCount > 0 && <em className="badge frozen">{frozenCount}</em>}
          </button>
        ))}
      </nav>

      <main className="view">
        {tab === "overview" && <OverviewTab d={derived} goto={goto} />}
        {tab === "register" && <RegisterTab d={derived} onAdd={handleAdd} />}
        {tab === "ranking" && <RankingTab d={derived} onCorrect={handleCorrect} onProfile={handleProfilePatch} />}
        {tab === "reminders" && <RemindersTab d={derived} />}
        {tab === "review" && <ReviewTab d={derived} onCorrect={handleCorrect} />}
        {tab === "retest" && <RetestTab d={derived} onConfirm={handleConfirm} />}
        {tab === "profile" && <ProfileTab d={derived} onProfile={handleProfilePatch} />}
        {tab === "history" && <HistoryTab store={store} d={derived} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
      <footer className="foot">
        规则 / 档案 / 界面分属 rules.ts · archive.ts · console.tsx — 关闭网络仍可使用，刷新后状态一致。
      </footer>
    </div>
  );
}

/* ================= 总览 ================= */

function OverviewTab({
  d,
  goto,
}: {
  d: ReturnType<typeof deriveAll>;
  goto: (t: Tab) => void;
}) {
  const returned = d.counts.returned;
  const rateBase = returned + d.counts.notReturned;
  const rate = rateBase ? Math.round((returned / rateBase) * 100) : 0;
  const avgSpeed =
    d.ranking.length > 0
      ? Math.round(d.ranking.reduce((s, r) => s + r.speed, 0) / d.ranking.length)
      : 0;

  return (
    <div className="stack">
      <section className="metric-grid">
        <Metric label="有效归巢率" value={rateBase ? `${rate}%` : "—"} hint={`${returned} 归 / ${d.counts.notReturned} 未归（仅核验通过）`} />
        <Metric label="平均分速" value={avgSpeed ? `${avgSpeed} m/min` : "—"} hint={`${d.ranking.length} 条有效成绩`} />
        <Metric label="训放点" value={String(d.counts.points)} hint="按鸽棚+坐标去重" warn={d.missingCoordLofts.length > 0} warnText={`${d.missingCoordLofts.length} 个鸽棚缺坐标`} />
        <Metric label="待复核 / 复测中" value={`${d.counts.review} / ${d.counts.frozen}`} hint="异常记录不参与任何结果" />
      </section>

      <div className="two-col">
        <section className="card">
          <CardHead title="核验规则" hint="登记时自动执行" />
          <ul className="rulelist">
            <li>训放点按<b>鸽棚 + 经纬度</b>唯一；重复登记只保留首次，首次距离作为 5% 偏差基准。</li>
            <li>坐标缺失、时间倒置（归巢早于放飞，或早于同点首次放飞）→ <Tag tone="warn">待复核</Tag></li>
            <li>登记距离与基准相差 <b>&gt;5%</b> → <Tag tone="warn">待复核</Tag></li>
            <li>待复核记录<b>不计</b>排行、未归巢提醒、配对候选与血统筛选。</li>
            <li>更正坐标 / 时刻后，原结果立即失效并重算，记录冻结，旧结果留档；须<b>两位复测人</b>（不含更正人）确认才恢复。</li>
          </ul>
        </section>

        <section className="card">
          <CardHead title="缺坐标鸽棚" hint="只进待复核" />
          {d.missingCoordLofts.length === 0 ? (
            <Empty text="暂无缺坐标登记" />
          ) : (
            <ul className="loftlist">
              {d.missingCoordLofts.map((l) => (
                <li key={l.loft}>
                  <b>{l.loft || "（未填鸽棚）"}</b>
                  <span>{l.count} 条等待坐标</span>
                </li>
              ))}
            </ul>
          )}
          <button className="linkbtn" onClick={() => goto("review")}>前往待复核队列 →</button>
        </section>
      </div>

      <section className="card">
        <CardHead title="训放点档案" hint={`${d.points.length} 个唯一训放点`} />
        {d.points.length === 0 ? (
          <Empty text="尚无有效坐标的训放点" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>鸽棚</th><th>坐标</th><th>基准距离</th><th>首次放飞</th><th>天气</th><th>有效成绩</th>
                </tr>
              </thead>
              <tbody>
                {d.points.map((p) => {
                  const rows = d.ranking.filter((r) => r.pointId === p.id);
                  return (
                    <tr key={p.id}>
                      <td><b>{p.loft}</b></td>
                      <td className="mono">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td>
                      <td>{p.baselineKm !== null ? `${p.baselineKm} km` : "—"}</td>
                      <td>{p.anchorAt ? p.anchorAt.replace("T", " ") : "—"}</td>
                      <td>{p.weather || "—"}</td>
                      <td>{rows.length} 条{rows[0] ? ` · 最快 ${Math.round(rows[0].speed)} m/min` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= 登记 ================= */

function RegisterTab({
  d,
  onAdd,
}: {
  d: ReturnType<typeof deriveAll>;
  onAdd: (input: RecordInput) => void;
}) {
  const [form, setForm] = useState<RecordInput>(emptyForm);
  const bloodlines = useMemo(
    () => [...new Set(d.records.map((r) => r.bloodline).filter(Boolean))].sort(),
    [d.records]
  );
  const lofts = useMemo(
    () => [...new Set(d.points.map((p) => p.loft))].sort(),
    [d.points]
  );

  const set = <K extends keyof RecordInput>(k: K, v: RecordInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (!form.ring.trim()) return alert("请填写足环号");
    if (!form.loft.trim()) return alert("请填写鸽棚");
    onAdd({
      ...form,
      distanceKm: form.distanceKm,
    });
    setForm(emptyForm());
  };

  return (
    <div className="stack">
      <section className="card">
        <CardHead title="登记训放记录" hint="足环 · 血统 · 时刻 · 坐标 · 距离 · 天气" />
        <div className="form-grid">
          <Field label="足环号" required>
            <input value={form.ring} onChange={(e) => set("ring", e.target.value)} placeholder="CHN-24-001839" />
          </Field>
          <Field label="血统">
            <input list="bloodlines" value={form.bloodline} onChange={(e) => set("bloodline", e.target.value)} placeholder="如：詹森系" />
            <datalist id="bloodlines">
              {bloodlines.map((b) => <option key={b} value={b} />)}
            </datalist>
          </Field>
          <Field label="鸽棚（训放点）" required>
            <input list="lofts" value={form.loft} onChange={(e) => set("loft", e.target.value)} placeholder="如：顺义北务" />
            <datalist id="lofts">
              {lofts.map((l) => <option key={l} value={l} />)}
            </datalist>
          </Field>
          <Field label="天气">
            <input value={form.weather} onChange={(e) => set("weather", e.target.value)} placeholder="晴 / 多云 / 侧风…" />
          </Field>
          <Field label="纬度 lat" hint="留空 → 坐标缺失待复核">
            <input inputMode="decimal" value={form.lat} onChange={(e) => set("lat", e.target.value)} placeholder="40.12540" />
          </Field>
          <Field label="经度 lng">
            <input inputMode="decimal" value={form.lng} onChange={(e) => set("lng", e.target.value)} placeholder="116.89210" />
          </Field>
          <Field label="放飞时刻">
            <input type="datetime-local" value={form.releaseAt} onChange={(e) => set("releaseAt", e.target.value)} />
          </Field>
          <Field label="归巢时刻" hint="未归巢请留空">
            <input type="datetime-local" value={form.returnAt} onChange={(e) => set("returnAt", e.target.value)} />
          </Field>
          <Field label="放飞距离 km" hint="与同点首次记录偏差 &gt;5% 进待复核">
            <input
              inputMode="decimal"
              value={form.distanceKm ?? ""}
              onChange={(e) =>
                set("distanceKm", e.target.value === "" ? null : Number(e.target.value))
              }
              placeholder="80"
            />
          </Field>
          <Field label="健康 / 备注">
            <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="健康状态等" />
          </Field>
        </div>
        <div className="form-actions">
          <button className="primary" onClick={submit}>登记并核验</button>
          <button className="ghost" onClick={() => setForm(emptyForm())}>清空</button>
        </div>
      </section>

      <section className="card">
        <CardHead title="现有训放点基准" hint="新登记距离会与此比对" />
        {d.points.length === 0 ? (
          <Empty text="还没有有效训放点，第一条有效登记将成为基准" />
        ) : (
          <div className="chips">
            {d.points.map((p) => (
              <span key={p.id} className="chip">
                {p.loft} <em className="mono">({p.lat.toFixed(4)}, {p.lng.toFixed(4)})</em>
                {p.baselineKm !== null ? ` · 基准 ${p.baselineKm}km（容差 ±${(p.baselineKm * 0.05).toFixed(1)}km）` : ""}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= 排行（含血统筛选） ================= */

function RankingTab({
  d,
  onCorrect,
  onProfile,
}: {
  d: ReturnType<typeof deriveAll>;
  onCorrect: CorrectHandler;
  onProfile: ProfilePatchHandler;
}) {
  const [blood, setBlood] = useState("");
  const [loft, setLoft] = useState("");
  const bloodlines = [...new Set(d.ranking.map((r) => r.bloodline).filter(Boolean))].sort();
  const lofts = [...new Set(d.ranking.map((r) => r.loft))].sort();
  const rows = d.ranking.filter(
    (r) => (!blood || r.bloodline === blood) && (!loft || r.loft === loft)
  );

  return (
    <div className="stack">
      <section className="card">
        <CardHead title="训放成绩排行" hint="仅含核验通过且已归巢记录；更正冻结期间自动移出并重算" />
        <div className="filters">
          <label>血统筛选
            <select value={blood} onChange={(e) => setBlood(e.target.value)}>
              <option value="">全部血统</option>
              {bloodlines.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label>鸽棚
            <select value={loft} onChange={(e) => setLoft(e.target.value)}>
              <option value="">全部训放点</option>
              {lofts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <span className="filter-count">{rows.length} 条</span>
        </div>

        {rows.length === 0 ? (
          <Empty text="暂无符合条件的有效成绩（待复核与复测中记录不参与排行）" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>足环号</th><th>血统</th><th>训放点</th><th>距离</th>
                  <th>用时</th><th>分速 m/min</th><th>归巢时刻</th><th>天气</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.recordId}>
                    <td><b>{i + 1}</b></td>
                    <td className="mono">{r.ring}</td>
                    <td>{r.bloodline || "—"}</td>
                    <td>{r.loft}<br /><small className="mono">{pointCoord(d, r.pointId)}</small></td>
                    <td>{r.distanceKm} km</td>
                    <td>{formatDuration(r.durationMin)}</td>
                    <td className="speed">{Math.round(r.speed)}</td>
                    <td>{r.returnAt.replace("T", " ")}</td>
                    <td>{r.weather || "—"}</td>
                    <td><CorrectionButton record={d.records.find((x) => x.id === r.recordId)!} onCorrect={onCorrect} onProfile={onProfile} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <CardHead title="配对候选" hint="有效成绩鸽按最佳分速排序，建议异血配对；异常记录不入围" />
        {d.candidates.length === 0 ? (
          <Empty text="暂无配对候选" />
        ) : (
          <div className="cand-grid">
            {d.candidates.slice(0, 8).map((c, i) => (
              <article key={c.ring} className="cand">
                <div className="cand-rank">#{i + 1}</div>
                <div>
                  <b className="mono">{c.ring}</b>
                  <p>{c.bloodline || "血统未登记"} · 最佳 {Math.round(c.bestSpeed)} m/min · {c.flights} 次有效</p>
                  <p className="partner">
                    {c.partnerRing ? <>建议异血搭档：<b className="mono">{c.partnerRing}</b>（{c.partnerBloodline}）</> : "暂无可匹配的异血候选"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= 未归巢提醒 ================= */

function RemindersTab({ d }: { d: ReturnType<typeof deriveAll> }) {
  const overdueMs = 6 * 3600 * 1000;
  return (
    <section className="card">
      <CardHead title="未归巢提醒" hint="仅统计核验通过记录；放飞超 6 小时标记为超时" />
      {d.reminders.length === 0 ? (
        <Empty text="暂无未归巢记录（待复核 / 复测中记录不在此提醒）" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>足环号</th><th>血统</th><th>鸽棚</th><th>放飞时刻</th><th>已飞行</th><th>天气</th><th>状态</th></tr>
            </thead>
            <tbody>
              {d.reminders.map((r) => {
                const elapsed = Date.now() - Date.parse(r.releaseAt);
                const overdue = elapsed > overdueMs;
                return (
                  <tr key={r.recordId}>
                    <td className="mono"><b>{r.ring}</b></td>
                    <td>{r.bloodline || "—"}</td>
                    <td>{r.loft}</td>
                    <td>{r.releaseAt.replace("T", " ")}</td>
                    <td>{formatDuration(elapsed / 60000)}</td>
                    <td>{r.weather || "—"}</td>
                    <td>{overdue ? <Tag tone="danger">超时未归</Tag> : <Tag tone="ok">在飞</Tag>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ================= 待复核 ================= */

function ReviewTab({
  d,
  onCorrect,
}: {
  d: ReturnType<typeof deriveAll>;
  onCorrect: CorrectHandler;
}) {
  const rows = d.records.filter((r) => r.status === "review");
  return (
    <section className="card">
      <CardHead title="待复核队列" hint="坐标缺失 / 时间倒置 / 距离偏差 >5% — 不计排行、提醒与配对" />
      {rows.length === 0 ? (
        <Empty text="没有待复核记录，所有档案均已通过核验" />
      ) : (
        <div className="stack-sm">
          {rows.map((r) => (
            <article key={r.id} className="issue-card">
              <div className="issue-head">
                <b className="mono">{r.ring}</b>
                <span>{r.bloodline || "血统未登记"} · {r.loft || "未填鸽棚"}</span>
                <div className="issue-tags">
                  {r.issues.length === 0 ? <Tag tone="warn">等待核验</Tag> : r.issues.map((i) => (
                    <Tag key={i.code} tone="warn" title={i.detail}>{ISSUE_TEXT[i.code]}</Tag>
                  ))}
                </div>
              </div>
              <p className="issue-detail">
                {r.issues.map((i) => i.detail).join("；") || "更正后等待复测恢复"}
              </p>
              <dl className="mini-facts">
                <dt>坐标</dt><dd className="mono">{r.lat && r.lng ? `${r.lat}, ${r.lng}` : "缺失"}</dd>
                <dt>放飞</dt><dd>{r.releaseAt ? r.releaseAt.replace("T", " ") : "—"}</dd>
                <dt>归巢</dt><dd>{r.returnAt ? r.returnAt.replace("T", " ") : "未归巢"}</dd>
                <dt>距离</dt><dd>{r.distanceKm !== null ? `${r.distanceKm} km` : "—"}</dd>
                <dt>天气</dt><dd>{r.weather || "—"}</dd>
              </dl>
              <CorrectionButton record={r} onCorrect={onCorrect} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* ================= 两人复测 ================= */

function RetestTab({
  d,
  onConfirm,
}: {
  d: ReturnType<typeof deriveAll>;
  onConfirm: (id: string, name: string) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const frozen = d.records.filter((r) => r.status === "frozen");
  return (
    <section className="card">
      <CardHead title="复测确认（两人）" hint="更正坐标 / 时刻后记录冻结，需两位复测人签署；复测人不得为更正人" />
      {frozen.length === 0 ? (
        <Empty text="当前没有复测中的记录" />
      ) : (
        <div className="stack-sm">
          {frozen.map((r) => {
            const need = Math.max(0, 2 - r.confirmers.length);
            return (
              <article key={r.id} className={"issue-card frozen-card"}>
                <div className="issue-head">
                  <b className="mono">{r.ring}</b>
                  <span>{r.bloodline || "血统未登记"} · {r.loft}</span>
                  <Tag tone="frozen">冻结中 · 还差 {need} 人确认</Tag>
                </div>
                <dl className="mini-facts">
                  <dt>更正人</dt><dd>{r.correctedBy}</dd>
                  <dt>坐标</dt><dd className="mono">{r.lat && r.lng ? `${r.lat}, ${r.lng}` : "缺失"}</dd>
                  <dt>放飞</dt><dd>{r.releaseAt ? r.releaseAt.replace("T", " ") : "—"}</dd>
                  <dt>归巢</dt><dd>{r.returnAt ? r.returnAt.replace("T", " ") : "未归巢"}</dd>
                  <dt>距离</dt><dd>{r.distanceKm !== null ? `${r.distanceKm} km` : "—"}</dd>
                </dl>
                <div className="conf-row">
                  <span>已确认：</span>
                  {r.confirmers.length === 0 && <em className="muted">暂无</em>}
                  {r.confirmers.map((c) => <Tag key={c} tone="ok">{c} ✓</Tag>)}
                </div>
                <div className="conf-actions">
                  <input
                    placeholder="复测人姓名"
                    value={names[r.id] ?? ""}
                    onChange={(e) => setNames((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                  <button
                    className="primary"
                    onClick={() => {
                      const n = (names[r.id] ?? "").trim();
                      if (n) {
                        onConfirm(r.id, n);
                        setNames((s) => ({ ...s, [r.id]: "" }));
                      }
                    }}
                  >
                    {r.confirmers.length === 0 ? "第 1 人复测确认" : "第 2 人复测确认并恢复"}
                  </button>
                </div>
                {r.issues.length > 0 && (
                  <p className="issue-detail">恢复时将重新核验：{r.issues.map((i) => ISSUE_TEXT[i.code]).join("、") || "—"}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ================= 单羽档案 + 血统历史 ================= */

function ProfileTab({
  d,
  onProfile,
}: {
  d: ReturnType<typeof deriveAll>;
  onProfile: ProfilePatchHandler;
}) {
  const rings = useMemo(() => {
    const map = new Map<string, EnrichedRecord>();
    for (const r of d.records) if (!map.has(r.ring)) map.set(r.ring, r);
    return [...map.keys()].sort();
  }, [d.records]);
  const [ring, setRing] = useState(rings[0] ?? "");
  useEffect(() => {
    if (!rings.includes(ring)) setRing(rings[0] ?? "");
  }, [rings, ring]);

  const [bloodFilter, setBloodFilter] = useState("");
  const allBloods = [...new Set(d.records.map((r) => r.bloodline).filter(Boolean))].sort();

  const mine = d.records.filter((r) => r.ring === ring);
  const bloodHistory = bloodFilter
    ? d.records.filter((r) => r.bloodline === bloodFilter && r.status === "active" && r.issues.length === 0)
    : [];

  return (
    <div className="two-col">
      <section className="card">
        <CardHead title="单羽赛鸽档案" hint="含全部状态训放记录" />
        <label className="block-label">选择足环号
          <select value={ring} onChange={(e) => setRing(e.target.value)}>
            {rings.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {mine.length === 0 ? (
          <Empty text="请选择赛鸽" />
        ) : (
          <PigeonProfile records={mine} onProfile={onProfile} />
        )}
      </section>

      <section className="card">
        <CardHead title="按血统筛选历史成绩" hint="只展示核验通过记录" />
        <label className="block-label">血统
          <select value={bloodFilter} onChange={(e) => setBloodFilter(e.target.value)}>
            <option value="">选择血统…</option>
            {allBloods.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        {bloodFilter === "" ? (
          <Empty text="请选择血统以查看历史成绩" />
        ) : bloodHistory.length === 0 ? (
          <Empty text={`「${bloodFilter}」暂无核验通过的历史成绩`} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>足环号</th><th>鸽棚</th><th>距离</th><th>分速</th><th>归巢时刻</th></tr></thead>
              <tbody>
                {bloodHistory
                  .filter((r) => r.speed !== null)
                  .sort((a, b) => b.speed! - a.speed!)
                  .map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.ring}</td>
                      <td>{r.loft}</td>
                      <td>{r.distanceKm} km</td>
                      <td className="speed">{Math.round(r.speed!)}</td>
                      <td>{r.returnAt.replace("T", " ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PigeonProfile({
  records,
  onProfile,
}: {
  records: EnrichedRecord[];
  onProfile: ProfilePatchHandler;
}) {
  const r0 = records[0];
  const validSpeeds = records.filter((r) => r.status === "active" && r.issues.length === 0 && r.speed !== null);
  const best = validSpeeds.sort((a, b) => b.speed! - a.speed!)[0];
  const [editing, setEditing] = useState(false);
  const [blood, setBlood] = useState(r0.bloodline);
  const [note, setNote] = useState(r0.note ?? "");
  useEffect(() => {
    setBlood(r0.bloodline);
    setNote(r0.note ?? "");
    setEditing(false);
  }, [r0.id]);

  return (
    <div className="stack-sm">
      <dl className="profile-facts">
        <dt>足环号</dt><dd className="mono">{r0.ring}</dd>
        <dt>血统</dt><dd>{r0.bloodline || "—"}</dd>
        <dt>最佳分速</dt><dd>{best ? `${Math.round(best.speed!)} m/min（${best.loft}）` : "暂无有效成绩"}</dd>
        <dt>训放次数</dt><dd>{records.length} 次（有效 {validSpeeds.length}）</dd>
      </dl>
      <div className="table-wrap">
        <table>
          <thead><tr><th>鸽棚</th><th>放飞</th><th>归巢</th><th>距离</th><th>天气</th><th>状态</th></tr></thead>
          <tbody>
            {[...records].sort((a, b) => Date.parse(b.releaseAt) - Date.parse(a.releaseAt)).map((r) => (
              <tr key={r.id} className={r.status !== "active" || r.issues.length ? "row-muted" : ""}>
                <td>{r.loft}</td>
                <td>{r.releaseAt ? r.releaseAt.replace("T", " ") : "—"}</td>
                <td>{r.returnAt ? r.returnAt.replace("T", " ") : "未归巢"}</td>
                <td>{r.distanceKm !== null ? `${r.distanceKm}km` : "—"}</td>
                <td>{r.weather || "—"}</td>
                <td><StatusTag r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <strong>健康 / 备注：</strong>
        {editing ? (
          <div className="inline-edit">
            <input value={blood} onChange={(e) => setBlood(e.target.value)} placeholder="血统" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="健康状态 / 备注" />
            <button className="primary" onClick={() => { onProfile(r0.id, { bloodline: blood, note }); setEditing(false); }}>保存</button>
            <button className="ghost" onClick={() => setEditing(false)}>取消</button>
          </div>
        ) : (
          <span className="note-line">
            {r0.note || "（无）"}
            <button className="linkbtn" onClick={() => setEditing(true)}>编辑血统 / 备注</button>
          </span>
        )}
      </div>
    </div>
  );
}

/* ================= 旧结果留档 ================= */

function HistoryTab({ store, d }: { store: Store; d: ReturnType<typeof deriveAll> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (store.history.length === 0) {
    return (
      <section className="card">
        <CardHead title="旧结果留档" hint="更正坐标 / 时刻时自动保存更正前完整结果" />
        <Empty text="尚无更正记录；发生更正后，旧排行、提醒与血统筛选结果可在此查阅" />
      </section>
    );
  }
  const open = store.history.find((h) => h.id === openId);
  return (
    <div className="two-col">
      <section className="card">
        <CardHead title="旧结果留档" hint="每条对应一次坐标 / 时刻更正" />
        <div className="stack-sm">
          {store.history.map((h) => {
            const rec = d.records.find((r) => r.id === h.recordId);
            return (
              <button key={h.id} className={"history-item" + (openId === h.id ? " active" : "")} onClick={() => setOpenId(h.id)}>
                <div>
                  <b>{h.label}</b>
                  <p>{h.correctedBy} 更正 · {h.reason}</p>
                  <p className="muted">
                    更正时排行 {h.snapshot.ranking.length} 条 · 未归 {h.snapshot.reminders.length} 羽
                    {" · "}确认：{h.confirmers.length ? h.confirmers.join("、") : "尚未复测"}
                  </p>
                </div>
                {h.restored ? <Tag tone="ok">已恢复</Tag> : <Tag tone="frozen">冻结中</Tag>}
                {rec && <span className="mono hidden-id">{rec.ring}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <CardHead title="更正前结果快照" hint={open ? formatDateTime(Date.parse(open.at)) : "选择左侧条目查看"} />
        {!open ? (
          <Empty text="选择一条更正记录查看旧结果" />
        ) : (
          <div className="stack-sm">
            <p className="snapshot-meta">
              更正人 <b>{open.correctedBy}</b>；原因：{open.reason}；
              复测人：{open.confirmers.length ? open.confirmers.join("、") : "暂无"}
              {open.restored && open.restoredAt ? `；已于 ${formatDateTime(Date.parse(open.restoredAt))} 恢复` : "；尚未恢复"}
            </p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>足环</th><th>血统</th><th>鸽棚</th><th>分速</th><th>归巢时刻</th></tr></thead>
                <tbody>
                  {open.snapshot.ranking.map((r: RankingRow, i: number) => (
                    <tr key={r.recordId}>
                      <td>{i + 1}</td><td className="mono">{r.ring}</td><td>{r.bloodline}</td>
                      <td>{r.loft}</td><td className="speed">{Math.round(r.speed)}</td>
                      <td>{r.returnAt.replace("T", " ")}</td>
                    </tr>
                  ))}
                  {open.snapshot.ranking.length === 0 && (
                    <tr><td colSpan={6} className="muted-center">旧排行无记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted">旧未归巢提醒：{open.snapshot.reminders.map((r) => r.ring).join("、") || "无"}</p>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= 更正弹层 ================= */

type CorrectHandler = (
  id: string,
  patch: VerifiablePatch,
  by: string,
  reason: string
) => boolean;
type ProfilePatchHandler = (
  id: string,
  patch: Partial<{ bloodline: string; weather: string; note: string }>
) => void;

function CorrectionButton({
  record,
  onCorrect,
  onProfile,
}: {
  record: EnrichedRecord;
  onCorrect: CorrectHandler;
  onProfile?: ProfilePatchHandler;
}) {
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState(record.lat);
  const [lng, setLng] = useState(record.lng);
  const [releaseAt, setReleaseAt] = useState(record.releaseAt);
  const [returnAt, setReturnAt] = useState(record.returnAt);
  const [dist, setDist] = useState(record.distanceKm === null ? "" : String(record.distanceKm));
  const [weather, setWeather] = useState(record.weather);
  const [by, setBy] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setLat(record.lat);
      setLng(record.lng);
      setReleaseAt(record.releaseAt);
      setReturnAt(record.returnAt);
      setDist(record.distanceKm === null ? "" : String(record.distanceKm));
      setWeather(record.weather);
    }
  }, [open, record]);

  const coordChanged = lat.trim() !== record.lat.trim() || lng.trim() !== record.lng.trim();
  const timeChanged = releaseAt !== record.releaseAt || returnAt !== record.returnAt;
  const distChanged =
    (dist === "" ? null : Number(dist)) !== record.distanceKm;

  const submit = () => {
    const patch: VerifiablePatch = {};
    if (coordChanged) {
      patch.lat = lat;
      patch.lng = lng;
    }
    if (timeChanged) {
      patch.releaseAt = releaseAt;
      patch.returnAt = returnAt;
    }
    if (distChanged) {
      patch.distanceKm = dist === "" ? null : Number(dist);
    }
    if (Object.keys(patch).length === 0) {
      // 仅天气变更属于普通档案信息
      if (onProfile && weather !== record.weather) {
        onProfile(record.id, { weather });
        setOpen(false);
        return;
      }
      alert("没有需要更正的坐标 / 时刻 / 距离变更");
      return;
    }
    if (onCorrect(record.id, patch, by, reason)) setOpen(false);
  };

  return (
    <>
      <button className="ghost sm" onClick={() => setOpen(true)}>
        {record.status === "frozen" ? "复测中…" : "更正"}
      </button>
      {open && record.status !== "frozen" && (
        <Modal onClose={() => setOpen(false)} title={`更正核验数据 · ${record.ring}`}>
          <div className="form-grid">
            <Field label="纬度"><input value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
            <Field label="经度"><input value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
            <Field label="放飞时刻"><input type="datetime-local" value={releaseAt} onChange={(e) => setReleaseAt(e.target.value)} /></Field>
            <Field label="归巢时刻"><input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} /></Field>
            <Field label="距离 km"><input inputMode="decimal" value={dist} onChange={(e) => setDist(e.target.value)} /></Field>
            <Field label="天气（不触发冻结）"><input value={weather} onChange={(e) => setWeather(e.target.value)} /></Field>
          </div>
          {(coordChanged || timeChanged || distChanged) && (
            <p className="warn-box">
              坐标 / 时刻 / 距离更正后：原排行、提醒、血统筛选结果立即失效并按新值重算；
              该记录冻结并保存旧结果，须 <b>两位复测人（不含更正人）</b>确认后才恢复。
            </p>
          )}
          <div className="form-grid">
            <Field label="更正人" required><input value={by} onChange={(e) => setBy(e.target.value)} placeholder="您的姓名" /></Field>
            <Field label="更正说明"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：GPS 重测、计时器校准" /></Field>
          </div>
          <div className="form-actions">
            <button className="primary" onClick={submit}>提交更正并冻结</button>
            <button className="ghost" onClick={() => setOpen(false)}>取消</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ================= 通用小组件 ================= */

function Metric({ label, value, hint, warn, warnText }: { label: string; value: string; hint: string; warn?: boolean; warnText?: string }) {
  return (
    <article className={"metric" + (warn ? " alert" : "")}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{warn && warnText ? warnText : hint}</span>
    </article>
  );
}

function CardHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}{required && <i>*</i>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Tag({ children, tone, title }: { children: React.ReactNode; tone: "warn" | "danger" | "ok" | "frozen"; title?: string }) {
  return <em className={"tag " + tone} title={title}>{children}</em>;
}

function StatusTag({ r }: { r: EnrichedRecord }) {
  if (r.status === "frozen") return <Tag tone="frozen">复测冻结</Tag>;
  if (r.status === "review" || r.issues.length > 0)
    return <Tag tone="warn">{r.issues[0] ? ISSUE_TEXT[r.issues[0].code] : "待复核"}</Tag>;
  if (r.returnAt.trim() === "") return <Tag tone="ok">在飞</Tag>;
  return <Tag tone="ok">有效</Tag>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost sm" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- 纯展示工具 ----------

function pointCoord(d: ReturnType<typeof deriveAll>, id: string): string {
  const p = d.points.find((x) => x.id === id);
  return p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : "";
}

function formatDuration(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}
