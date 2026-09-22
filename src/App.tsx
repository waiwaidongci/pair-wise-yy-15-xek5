import "./styles.css";

const project = {
  "sourceNo": 9,
  "id": "hxyfront-62014",
  "port": 62014,
  "title": "赛鸽训放记录",
  "domain": "赛鸽训放",
  "prompt": "我想做一个面向赛鸽棚的训放记录前端工具，鸽主可以记录足环号、血统、训放地点、放飞距离、天气、归巢时间、飞行速度、健康状态和配对记录。页面需要有鸽棚总览、训放成绩排行、未归巢提醒、单羽赛鸽档案和按血统筛选的历史成绩。",
  "palette": [
    "#1d4ed8",
    "#64748b",
    "#f97316"
  ],
  "metrics": [
    "归巢率",
    "平均速度",
    "未归巢",
    "血统档案"
  ],
  "filters": [
    "短距离",
    "中距离",
    "长距离",
    "种鸽"
  ],
  "fields": [
    "足环号",
    "血统",
    "训放地点",
    "放飞距离",
    "归巢时间",
    "健康状态"
  ],
  "records": [
    [
      "CHN-24-001839",
      "詹森系",
      "80km，晴",
      "均速1180m/min"
    ],
    [
      "CHN-24-002114",
      "凡龙系",
      "120km，侧风",
      "归巢延迟"
    ],
    [
      "CHN-23-008771",
      "种鸽",
      "配对记录更新",
      "健康正常"
    ]
  ]
};

function App() {
  return (
    <main className="app">
      <section className="hero">
        <p>{project.id} · 源提示词{project.sourceNo} · Port {project.port}</p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {project.metrics.map((metric: string, index: number) => (
          <article key={metric}>
            <small>{metric}</small>
            <strong>{[28, 6, 14, 91][index] ?? 10}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}分类</h2>
          <div className="chips">
            {project.filters.map((item: string) => (
              <button key={item}>{item}</button>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录</h2>
            </div>
            <button className="primary">保存记录</button>
          </div>
          <div className="field-grid">
            {project.fields.map((field: string) => (
              <label key={field}>
                <span>{field}</span>
                <input placeholder={"填写" + field} />
              </label>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>近期记录</p>
            <h2>工作台摘要</h2>
          </div>
          <button>导出CSV</button>
        </div>
        <div className="records">
          {project.records.map((record: string[], index: number) => (
            <article key={record.join("-")}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <h3>{record[0]}</h3>
                <p>{record.slice(1).join(" · ")}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
