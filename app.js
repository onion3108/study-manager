const DATA = window.STUDY_DATA;
const STORAGE = {
  todos: "study-manager-v2-todos",
  plans: "study-manager-v2-plans",
  jobs: "study-manager-v2-jobs",
};

const routes = [
  { id: "home", label: "ホーム", icon: "home" },
  { id: "calendar", label: "カレンダー", icon: "calendar" },
  { id: "todo", label: "Todo", icon: "check" },
  { id: "questions", label: "問題", icon: "book" },
  { id: "import", label: "AI取り込み", icon: "upload" },
  { id: "settings", label: "設定", icon: "settings" },
];

let state = {
  route: "home",
  calendarTab: "day24",
  selectedDate: DATA.today,
  homeDate: DATA.today,
  selectedYear: Number(DATA.today.slice(0, 4)),
  selectedMonth: Number(DATA.today.slice(5, 7)),
  todos: loadState(STORAGE.todos, DATA.todos),
  plans: loadState(STORAGE.plans, seedPlans()),
  jobs: loadState(STORAGE.jobs, []),
  activeClass: null,
  scheduleDraft: null,
  ocrDraft: null,
  settings: loadState("study-manager-v2-settings", {
    ollamaModel: "elyza:jp8b",
    ocrLanguage: "japan",
    defaultQuestionCount: 10,
  }),
};

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  renderAll();
  bindGlobalActions();
});

function renderAll() {
  renderNavState();
  renderHome();
  renderCalendar();
  renderTodoPage();
  renderQuestions();
  renderImportCenter();
  renderSettings();
}

function renderNav() {
  const navHtml = routes
    .map((route) => `<button class="nav-item" data-route="${route.id}" type="button"><span class="nav-icon">${icon(route.icon)}</span>${route.label}</button>`)
    .join("");
  const bottomHtml = routes
    .map((route) => `<button class="bottom-item" data-route="${route.id}" type="button"><span>${icon(route.icon)}</span>${route.label}</button>`)
    .join("");
  document.getElementById("side-nav").innerHTML = navHtml;
  document.getElementById("bottom-nav").innerHTML = bottomHtml;
  document.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.route)));
}

function renderNavState() {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  document.getElementById(`${state.route}-view`).classList.add("active-view");
  document.querySelectorAll("[data-route]").forEach((button) => button.classList.toggle("active", button.dataset.route === state.route));
}

function setRoute(route) {
  state.route = route;
  renderAll();
}

function renderHome() {
  const date = state.homeDate;
  const ideal = getPlan(date, "ideal");
  const todayTodos = todosForDate(date);
  const dayEvents = eventsOnDate(date);
  const timetable = timetableForDate(date);
  const countdowns = getCountdowns(date).slice(0, 3);
  const menu = menuForDate(date);
  const view = document.getElementById("home-view");
  view.innerHTML = `
    <div class="page-heading tight">
      <div>
        <p class="eyebrow">${formatLongDate(date)}${date === nextDate(DATA.today, 1) ? "（明日）" : ""}</p>
        <h1>今日やること</h1>
      </div>
      <div class="heading-actions">
        <button class="ghost-button" id="show-today-home" type="button">今日</button>
      </div>
    </div>
    <div class="home-layout">
      <section class="panel hero-panel">
        <div class="panel-header compact">
          <div>
            <p class="section-kicker">24時間</p>
            <h2>${formatShortDate(date)}の理想スケジュール</h2>
          </div>
          <button class="ghost-button" data-calendar-jump="day24" type="button">編集・比較</button>
        </div>
        <div class="home-hero-grid">
          <div id="home-pie" class="pie-chart large"></div>
          <div>
            <div id="home-legend" class="legend compact-legend"></div>
            <button class="secondary-action full small-top" id="copy-ideal-actual-home" type="button">理想をコピーして実際を作る</button>
          </div>
        </div>
      </section>
      <section class="panel action-panel">
        <div class="panel-header compact">
          <div>
            <p class="section-kicker">Todo / 課題 / 復習 / 問題</p>
            <h2>今日はこれだけやればOK</h2>
          </div>
        </div>
        <div class="todo-list compact-list">${todayTodos.slice(0, 5).map(renderTodoItem).join("") || emptyText("今日のTodoはありません")}</div>
        <div class="button-row">
          <button class="secondary-action" data-route="questions" type="button">今日の問題を解く</button>
          <button class="ghost-button" data-route="todo" type="button">Todo管理</button>
        </div>
      </section>
      <section class="panel info-panel events-home">
        <p class="section-kicker">カレンダー予定のみ</p>
        <h2>今日の予定</h2>
        <div class="event-list dense">${dayEvents.map(renderEventCard).join("") || emptyText("学校予定はありません")}</div>
      </section>
      <section class="panel info-panel countdown-home">
        <p class="section-kicker">重要イベント</p>
        <h2>カウントダウン</h2>
        <div class="countdown-list dense">${countdowns.map(renderCountdown).join("")}</div>
      </section>
      <section class="panel timetable-home">
        <p class="section-kicker">S3-2</p>
        <h2>今日の時間割</h2>
        <div class="mini-timetable">${timetable.map((entry) => renderVerticalClassCard(entry, date)).join("") || emptyText("授業はありません")}</div>
      </section>
      <section class="panel menu-home">
        <p class="section-kicker">八太郎館</p>
        <h2>今日の献立</h2>
        ${renderMenu(menu)}
      </section>
    </div>
  `;
  renderPie("home-pie", ideal.blocks, "理想");
  renderLegend("home-legend", ideal.blocks);
  bindTodoCheckboxes(view);
  bindClassCards(view);
  view.querySelector("#show-today-home").addEventListener("click", () => {
    state.homeDate = DATA.today;
    renderHome();
  });
  view.querySelector("#copy-ideal-actual-home").addEventListener("click", () => copyIdealToActual(date));
  bindRouteButtons(view);
  bindCalendarJumpButtons(view);
}

function renderCalendar() {
  const view = document.getElementById("calendar-view");
  view.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">${formatLongDate(state.selectedDate)}</p>
        <h1>カレンダー</h1>
      </div>
      <div class="heading-actions">
        <button class="ghost-button" id="calendar-today" type="button">今日</button>
        <button class="primary-action" id="calendar-new-plan" type="button">＋ 明日の理想円グラフ</button>
      </div>
    </div>
    <div class="segmented" role="tablist" aria-label="カレンダー表示切り替え">
      ${["day24", "day", "week", "month", "year"].map((tab) => `<button class="segment ${state.calendarTab === tab ? "active" : ""}" data-calendar-tab="${tab}" type="button">${calendarTabLabel(tab)}</button>`).join("")}
    </div>
    <div id="calendar-content" class="calendar-content"></div>
  `;
  view.querySelectorAll("[data-calendar-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendarTab = button.dataset.calendarTab;
      renderCalendar();
    });
  });
  view.querySelector("#calendar-today").addEventListener("click", () => {
    state.selectedDate = DATA.today;
    state.selectedYear = Number(DATA.today.slice(0, 4));
    state.selectedMonth = Number(DATA.today.slice(5, 7));
    state.calendarTab = "day";
    renderCalendar();
  });
  view.querySelector("#calendar-new-plan").addEventListener("click", () => openScheduleModal(nextDate(DATA.today, 1), "ideal"));
  const content = view.querySelector("#calendar-content");
  if (state.calendarTab === "day24") renderDay24(content);
  if (state.calendarTab === "day") renderDay(content, state.selectedDate);
  if (state.calendarTab === "week") renderWeek(content);
  if (state.calendarTab === "month") renderMonth(content, state.selectedYear, state.selectedMonth);
  if (state.calendarTab === "year") renderYear(content, state.selectedYear);
}

function renderDay24(content) {
  const ideal = getPlan(state.selectedDate, "ideal");
  const actual = getPlan(state.selectedDate, "actual");
  content.innerHTML = `
    <div class="compare-grid">
      <section class="panel">
        <div class="panel-header compact">
          <div><p class="section-kicker">理想</p><h2>${formatShortDate(state.selectedDate)}</h2></div>
          <button class="ghost-button" id="edit-ideal" type="button">編集</button>
        </div>
        <div id="ideal-pie" class="pie-chart"></div>
        <div id="ideal-legend" class="legend"></div>
      </section>
      <section class="panel">
        <div class="panel-header compact">
          <div><p class="section-kicker">実際</p><h2>達成度 ${achievement(actual.blocks)}%</h2></div>
          <button class="ghost-button" id="edit-actual" type="button">編集</button>
        </div>
        <div id="actual-pie" class="pie-chart"></div>
        <div id="actual-legend" class="legend"></div>
      </section>
      <section class="panel wide-panel">
        <div class="panel-header">
          <div>
            <p class="section-kicker">比較</p>
            <h2>理想と実際の差</h2>
          </div>
          <button id="copy-ideal-actual" class="primary-action" type="button">理想をコピーして実際スケジュールを作る</button>
        </div>
        <div class="metric-grid">
          ${["study", "sleep", "free", "school"].map((category) => renderMetric(category, ideal.blocks, actual.blocks)).join("")}
        </div>
      </section>
    </div>
  `;
  renderPie("ideal-pie", ideal.blocks, "理想");
  renderLegend("ideal-legend", ideal.blocks);
  renderPie("actual-pie", actual.blocks, "実際");
  renderLegend("actual-legend", actual.blocks);
  content.querySelector("#edit-ideal").addEventListener("click", () => openScheduleModal(state.selectedDate, "ideal"));
  content.querySelector("#edit-actual").addEventListener("click", () => openScheduleModal(state.selectedDate, "actual"));
  content.querySelector("#copy-ideal-actual").addEventListener("click", () => copyIdealToActual(state.selectedDate));
}

function renderDay(content, date) {
  const dayTodos = todosForDate(date);
  const timetable = timetableForDate(date);
  content.innerHTML = `
    <div class="day-practical-grid">
      <section class="panel">
        <p class="section-kicker">学校予定</p>
        <h2>${formatShortDate(date)}の予定</h2>
        <div class="event-list">${eventsOnDate(date).map(renderEventCard).join("") || emptyText("予定はありません")}</div>
      </section>
      <section class="panel">
        <p class="section-kicker">Todo / 課題 / 復習 / AI生成問題</p>
        <h2>チェックリスト</h2>
        <div class="todo-list">${dayTodos.map(renderTodoItem).join("") || emptyText("Todoはありません")}</div>
      </section>
      <section class="panel day-timetable-panel">
        <p class="section-kicker">時間割</p>
        <h2>授業とアップロード</h2>
        <div class="vertical-timetable">${timetable.map((entry) => renderVerticalClassCard(entry, date)).join("") || emptyText("授業はありません")}</div>
      </section>
      <section class="panel">
        <p class="section-kicker">献立</p>
        <h2>八太郎館</h2>
        ${renderMenu(menuForDate(date))}
      </section>
    </div>
  `;
  bindTodoCheckboxes(content);
  bindClassCards(content);
}

function renderWeek(content) {
  const week = weekDates(state.selectedDate);
  const rows = [1, 2, 3, 4, 5, 6, 7];
  content.innerHTML = `
    <section class="panel table-panel">
      <div class="panel-header">
        <div>
          <p class="section-kicker">月〜日</p>
          <h2>週間時間割</h2>
        </div>
      </div>
      <div class="timetable-table-wrap">
        <table class="timetable-table">
          <thead>
            <tr>
              <th>時限</th>
              ${week.map((date) => `<th><button class="date-head" data-date="${date}" type="button">${weekdayLabel(date)}<span>${formatMonthDay(date)}</span></button></th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (period) => `
                  <tr>
                    <th>${period}限</th>
                    ${week.map((date) => renderTimetableCell(date, period)).join("")}
                  </tr>
                `,
              )
              .join("")}
            <tr>
              <th>放課後/予定</th>
              ${week.map((date) => `<td class="after-cell">${eventsOnDate(date).slice(0, 2).map((event) => `<button class="small-event type-${event.event_type}" data-date="${date}" type="button">${event.title}</button>`).join("") || "<span class=\"muted\">なし</span>"}</td>`).join("")}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
  content.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => goDay(button.dataset.date));
  });
  bindClassCards(content);
}

function renderMonth(content, year, month) {
  const days = monthGrid(year, month);
  content.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <button class="ghost-button" id="prev-month" type="button">‹ 前月</button>
        <div class="center-title">
          <p class="section-kicker">月表示</p>
          <h2>${year}年${month}月</h2>
        </div>
        <button class="ghost-button" id="next-month" type="button">翌月 ›</button>
      </div>
      <div class="month-calendar">
        ${["日", "月", "火", "水", "木", "金", "土"].map((d) => `<div class="calendar-weekday">${d}</div>`).join("")}
        ${days.map(renderMonthDay).join("")}
      </div>
    </section>
  `;
  content.querySelector("#prev-month").addEventListener("click", () => shiftMonth(-1));
  content.querySelector("#next-month").addEventListener("click", () => shiftMonth(1));
  content.querySelectorAll(".month-day").forEach((cell) => {
    cell.addEventListener("click", () => goDay(cell.dataset.date));
  });
}

function renderYear(content, year) {
  content.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="section-kicker">年間</p>
          <h2>${year}年 年間カレンダー</h2>
        </div>
      </div>
      <div class="year-calendar">
        ${Array.from({ length: 12 }, (_, index) => renderMiniMonth(year, index + 1)).join("")}
      </div>
    </section>
  `;
  content.querySelectorAll(".mini-month").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedMonth = Number(card.dataset.month);
      state.calendarTab = "month";
      renderCalendar();
    });
  });
}

function renderTodoPage() {
  const view = document.getElementById("todo-view");
  view.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">Todo / 課題</p>
        <h1>Todo管理</h1>
      </div>
    </div>
    <div class="todo-page-grid">
      <section class="panel">
        <div class="panel-header compact">
          <div><p class="section-kicker">追加</p><h2>やることを登録</h2></div>
        </div>
        <form id="todo-form" class="todo-form">
          <label>タイトル<input id="todo-title" required placeholder="数学C ワーク p32〜35" /></label>
          <label>科目<select id="todo-subject">${DATA.subjects.map((subject) => `<option>${subject}</option>`).join("")}<option>その他</option></select></label>
          <label>期限日</label>
          <div class="chip-row" id="due-chips">
            ${[
              ["今日", DATA.today],
              ["明日", nextDate(DATA.today, 1)],
              ["3日後", nextDate(DATA.today, 3)],
              ["1週間後", nextDate(DATA.today, 7)],
            ].map(([label, value]) => `<button class="choice-chip" data-due="${value}" type="button">${label}</button>`).join("")}
          </div>
          <input id="todo-due" type="date" value="${DATA.today}" />
          <label>リマインド</label>
          <div class="chip-row" id="reminder-chips">
            ${["3日前", "1日前", "当日", "なし", "任意"].map((label) => `<button class="choice-chip ${label === "1日前" ? "active" : ""}" data-reminder="${label}" type="button">${label}</button>`).join("")}
          </div>
          <label>繰り返し</label>
          <div class="form-grid two">
            <select id="todo-repeat">
              <option>なし</option>
              <option>毎週</option>
              <option>隔週</option>
              <option>毎月</option>
            </select>
            <select id="todo-repeat-weekday">
              <option value="">曜日指定なし</option>
              <option value="1">月</option>
              <option value="2">火</option>
              <option value="3">水</option>
              <option value="4">木</option>
              <option value="5">金</option>
              <option value="6">土</option>
              <option value="0">日</option>
            </select>
          </div>
          <label class="check-line"><input id="todo-countdown" type="checkbox" /> カウントダウンに表示する</label>
          <label class="check-line"><input id="todo-calendar" type="checkbox" checked /> カレンダーに表示する</label>
          <button class="primary-action full" type="submit">Todoを追加</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header compact">
          <div><p class="section-kicker">一覧</p><h2>未完了と完了</h2></div>
        </div>
        <div class="todo-columns">
          <div>
            <h3>未完了</h3>
            <div class="todo-list scroll-list">${state.todos.filter((todo) => !todo.completed).map(renderTodoItem).join("") || emptyText("未完了Todoはありません")}</div>
          </div>
          <div>
            <h3>完了</h3>
            <div class="todo-list scroll-list">${state.todos.filter((todo) => todo.completed).map(renderTodoItem).join("") || emptyText("完了Todoはありません")}</div>
          </div>
        </div>
      </section>
    </div>
  `;
  const form = view.querySelector("#todo-form");
  view.querySelectorAll("[data-due]").forEach((button) => {
    button.addEventListener("click", () => {
      view.querySelector("#todo-due").value = button.dataset.due;
      view.querySelectorAll("[data-due]").forEach((chip) => chip.classList.toggle("active", chip === button));
    });
  });
  let reminder = "1日前";
  view.querySelectorAll("[data-reminder]").forEach((button) => {
    button.addEventListener("click", () => {
      reminder = button.dataset.reminder;
      view.querySelectorAll("[data-reminder]").forEach((chip) => chip.classList.toggle("active", chip === button));
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = view.querySelector("#todo-title").value.trim();
    if (!title) return;
    state.todos.unshift({
      id: crypto.randomUUID(),
      title,
      subject: view.querySelector("#todo-subject").value,
      kind: "Todo",
      dueDate: view.querySelector("#todo-due").value,
      completed: false,
      reminder,
      showOnCalendar: view.querySelector("#todo-calendar").checked,
      countdownEnabled: view.querySelector("#todo-countdown").checked,
      repeat: view.querySelector("#todo-repeat").value,
      repeatWeekday: view.querySelector("#todo-repeat-weekday").value,
    });
    saveState(STORAGE.todos, state.todos);
    renderAll();
    showToast("Todoを追加しました");
  });
  bindTodoCheckboxes(view);
}

function renderQuestions() {
  document.getElementById("questions-view").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Questions</p><h1>問題</h1></div></div>
    <section class="panel">
      <div class="panel-header">
        <div><p class="section-kicker">今日の問題</p><h2>12問ランナー</h2></div>
        <button class="primary-action" type="button">開始</button>
      </div>
      <div class="problem-grid">
        <div><strong>数学C</strong><span>5問</span></div>
        <div><strong>英コIII</strong><span>4問</span></div>
        <div><strong>論国</strong><span>3問</span></div>
      </div>
    </section>
  `;
}

function renderImportCenter() {
  const view = document.getElementById("import-view");
  const counts = jobCounts();
  view.innerHTML = `
    <div class="page-heading">
      <div><p class="eyebrow">Local AI Queue</p><h1>AI取り込みセンター</h1></div>
      <div class="heading-actions">
        <button id="download-jobs" class="ghost-button" type="button">AI jobsを書き出す</button>
      </div>
    </div>
    <section class="panel ai-status-panel">
      <div class="status-grid">
        <div><span>AI実行</span><strong>PC側worker</strong></div>
        <div><span>保存</span><strong>localStorage</strong></div>
        <div><span>Model</span><strong id="ollama-model">${state.settings.ollamaModel}</strong></div>
        <div><span>処理待ち件数</span><strong>${counts.pending}</strong></div>
        <div><span>処理中件数</span><strong>${counts.processing}</strong></div>
        <div><span>処理完了件数</span><strong>${counts.completed}</strong></div>
        <div><span>失敗件数</span><strong>${counts.failed}</strong></div>
      </div>
      <div class="button-row">
        <button id="download-jobs-secondary" class="ghost-button" type="button">AI jobsを書き出す</button>
        <label class="ghost-button file-button">AI結果を読み込む<input id="jobs-import" type="file" accept="application/json,.json" /></label>
        <a class="ghost-button as-link" href="./worker/README.md" target="_blank" rel="noreferrer">workerの使い方を見る</a>
      </div>
      <p class="note-text">GitHub Pages上ではOllama・PaddleOCR・localhostへ接続しません。画像/PDFはjobs.jsonへ書き出し、PC側workerで処理します。</p>
    </section>
    <div class="import-grid">
      <section class="panel">
        <div class="panel-header compact"><div><p class="section-kicker">アップロード</p><h2>処理待ちへ追加</h2></div></div>
        <label>分類<select id="import-kind">
          <option value="annual_schedule">年間予定</option>
          <option value="monthly_schedule">月間予定</option>
          <option value="timetable">時間割</option>
          <option value="timetable_change">時間割変更</option>
          <option value="menu">給食表</option>
          <option value="assignment">課題プリント</option>
          <option value="board">板書</option>
          <option value="note">ノート</option>
          <option value="test_result">テスト成績</option>
          <option value="question_print">問題プリント</option>
          <option value="other">その他</option>
        </select></label>
        <div id="import-options" class="import-options"></div>
        <label class="upload-box">PDF / 画像を選択<input id="file-input" type="file" accept="image/*,.pdf" /></label>
        <button id="enqueue-job" class="primary-action full" type="button">pendingとして保存</button>
      </section>
      <section class="panel">
        <div class="panel-header compact"><div><p class="section-kicker">確認画面</p><h2>解析結果候補</h2></div></div>
        <div id="review-panel" class="review-box"></div>
      </section>
      <section class="panel wide-panel">
        <div class="panel-header compact"><div><p class="section-kicker">ai_jobs</p><h2>処理待ち・結果</h2></div></div>
        <div class="job-list">${state.jobs.map(renderJob).join("")}</div>
      </section>
    </div>
  `;
  const kind = view.querySelector("#import-kind");
  const updateOptions = () => {
    const value = kind.value;
    view.querySelector("#import-options").innerHTML = value === "timetable_change"
      ? `<label>反映開始日 <input id="effective-from" type="date" required /></label><p class="note-text">時間割変更では反映開始日が必須です。</p>`
      : value === "annual_schedule"
        ? `<label>対象学年フィルタ <select id="grade-filter"><option value="grade3" selected>高校3年のみ</option><option value="all_high">高校全学年</option></select></label><p class="note-text">1年生だけ・2年生だけの予定は取り込み対象外にします。</p>`
        : `<p class="note-text">ブラウザからOllamaへ直接接続せず、pendingジョブだけを保存します。</p>`;
    renderReviewPanel(value);
  };
  kind.addEventListener("change", updateOptions);
  updateOptions();
  view.querySelector("#enqueue-job").addEventListener("click", () => enqueueImportJob(view));
  view.querySelector("#download-jobs").addEventListener("click", downloadJobs);
  view.querySelector("#download-jobs-secondary").addEventListener("click", downloadJobs);
  view.querySelector("#jobs-import").addEventListener("change", importJobs);
}

function renderSettings() {
  const view = document.getElementById("settings-view");
  view.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Settings</p><h1>設定</h1></div></div>
    <div class="settings-sections">
      <section class="panel">
        <p class="section-kicker">プロフィール</p>
        <h2>学校情報</h2>
        <div class="settings-grid">
          <label><span>学年</span><input value="高校3年" /></label>
          <label><span>クラス</span><input value="S3-2" /></label>
          <label><span>通常時間割</span><input value="S3-2 月〜土" /></label>
          <label><span>表示する曜日</span><input value="月,火,水,木,金,土,日" /></label>
        </div>
      </section>
      <section class="panel">
        <p class="section-kicker">AI設定</p>
        <h2>Ollama worker</h2>
        <div class="settings-grid">
          <label><span>接続方式</span><input value="Node worker + jobs.json" /></label>
          <label><span>モデル名</span><input id="setting-model" value="${state.settings.ollamaModel}" /></label>
          <label><span>OCR言語</span><input id="setting-ocr-language" value="${state.settings.ocrLanguage}" /></label>
          <label><span>要約の長さ</span><input value="短め" /></label>
          <label><span>生成問題数</span><input id="setting-question-count" type="number" min="1" max="20" value="${state.settings.defaultQuestionCount}" /></label>
          <label><span>問題形式</span><input value="一問一答, 4択, 記述" /></label>
          <label class="check-line"><input type="checkbox" checked /> AI完了後に問題へ追加する</label>
        </div>
      </section>
      <section class="panel">
        <p class="section-kicker">Todo設定</p>
        <h2>初期値</h2>
        <div class="settings-grid">
          <label><span>デフォルトリマインド</span><input value="1日前" /></label>
          <label class="check-line"><input type="checkbox" checked /> 完了済みTodoを表示する</label>
          <label class="check-line"><input type="checkbox" checked /> Todoをカレンダーに自動表示する</label>
        </div>
      </section>
      <section class="panel">
        <p class="section-kicker">カレンダー設定</p>
        <h2>表示</h2>
        <div class="settings-grid">
          <label><span>初期表示</span><input value="24時間" /></label>
          <label class="check-line"><input type="checkbox" checked /> 今日ボタンを表示</label>
          <label><span>週の開始曜日</span><input value="月曜日" /></label>
          <label class="check-line"><input type="checkbox" checked /> 土日を表示</label>
          <label><span>カウントダウン対象</span><input value="定期考査, 実力テスト, TOEFL, Todo" /></label>
        </div>
      </section>
      <section class="panel">
        <p class="section-kicker">表示設定</p>
        <h2>見た目</h2>
        <div class="settings-grid">
          <label><span>テーマ</span><input value="ライト" /></label>
          <label><span>カード密度</span><input value="コンパクト" /></label>
          <label><span>文字サイズ</span><input value="標準" /></label>
        </div>
      </section>
      <section class="panel">
        <p class="section-kicker">データ管理</p>
        <h2>ローカルデータ</h2>
        <div class="button-row">
          <button class="ghost-button" type="button">ローカルデータを書き出し</button>
          <button class="ghost-button" type="button">ローカルデータを読み込み</button>
          <button class="ghost-button" type="button">AI jobsを書き出し</button>
          <button class="ghost-button" type="button">AI結果を読み込み</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="section-kicker">保存</p>
            <h2>設定を保存</h2>
          </div>
          <button id="save-settings" class="primary-action" type="button">保存</button>
        </div>
        <p class="note-text">保存した設定はlocalStorageに残り、画面更新後も使用されます。worker側ではREADMEの通り環境変数にも同じモデル名を指定してください。</p>
      </section>
    </div>
  `;
  view.querySelector("#save-settings").addEventListener("click", () => {
    state.settings = {
      ...state.settings,
      ollamaModel: view.querySelector("#setting-model").value.trim() || "elyza:jp8b",
      ocrLanguage: view.querySelector("#setting-ocr-language").value.trim() || "japan",
      defaultQuestionCount: Number(view.querySelector("#setting-question-count").value) || 10,
    };
    saveState("study-manager-v2-settings", state.settings);
    showToast("保存しました");
    renderAll();
  });
}

function openScheduleModal(date, planType, sourceBlocks = null) {
  const plan = sourceBlocks ? { blocks: cloneBlocks(sourceBlocks) } : getPlan(date, planType);
  state.scheduleDraft = {
    date,
    planType,
    blocks: cloneBlocks(plan.blocks),
    templateId: DATA.scheduleTemplates[0].id,
  };
  document.getElementById("schedule-modal-title").textContent = planType === "ideal" ? "理想円グラフを作成・編集" : "実際スケジュールを入力";
  document.getElementById("schedule-modal-date").textContent = `${formatLongDate(date)} / ${planType === "ideal" ? "理想" : "実際"}`;
  document.getElementById("schedule-modal").classList.add("open");
  document.getElementById("schedule-modal").setAttribute("aria-hidden", "false");
  renderScheduleEditor();
}

function renderScheduleEditor() {
  const editor = document.getElementById("schedule-editor");
  const draft = state.scheduleDraft;
  editor.innerHTML = `
    <div class="editor-toolbar">
      <label>テンプレート<select id="template-select">${DATA.scheduleTemplates.map((template) => `<option value="${template.id}">${template.name}</option>`).join("")}</select></label>
      <button id="apply-template" class="ghost-button" type="button">テンプレートを適用</button>
      <button id="add-block" class="secondary-action" type="button">ブロック追加</button>
    </div>
    <div class="schedule-block-list">
      ${draft.blocks.map((block, index) => renderBlockEditor(block, index, draft.planType)).join("")}
    </div>
    <div class="modal-footer">
      <button id="save-schedule" class="primary-action" type="button">保存</button>
    </div>
  `;
  editor.querySelector("#apply-template").addEventListener("click", () => {
    const id = editor.querySelector("#template-select").value;
    const template = DATA.scheduleTemplates.find((item) => item.id === id);
    draft.blocks = cloneBlocks(template.blocks);
    if (draft.planType === "actual") draft.blocks = draft.blocks.map((block) => ({ ...block, achievementPercent: 80 }));
    renderScheduleEditor();
  });
  editor.querySelector("#add-block").addEventListener("click", () => {
    draft.blocks.push({ id: crypto.randomUUID(), category: "study", label: "新しい予定", startTime: "20:00", endTime: "21:00", achievementPercent: draft.planType === "actual" ? 80 : undefined });
    renderScheduleEditor();
  });
  editor.querySelectorAll("[data-block-index]").forEach((row) => {
    const index = Number(row.dataset.blockIndex);
    row.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("change", () => {
        draft.blocks[index][input.dataset.field] = input.type === "number" ? Number(input.value) : input.value;
      });
    });
    row.querySelector("[data-delete-block]").addEventListener("click", () => {
      draft.blocks.splice(index, 1);
      renderScheduleEditor();
    });
  });
  editor.querySelector("#save-schedule").addEventListener("click", saveScheduleDraft);
}

function saveScheduleDraft() {
  const draft = state.scheduleDraft;
  const key = `${draft.date}:${draft.planType}`;
  state.plans[key] = {
    date: draft.date,
    planType: draft.planType,
    blocks: normalizeBlocks(draft.blocks),
  };
  saveState(STORAGE.plans, state.plans);
  closeScheduleModal();
  state.selectedDate = draft.date;
  state.homeDate = draft.date;
  state.calendarTab = "day24";
  renderAll();
  showToast(`${formatShortDate(draft.date)}の${draft.planType === "ideal" ? "理想" : "実際"}スケジュールを保存しました`);
}

function copyIdealToActual(date) {
  const ideal = getPlan(date, "ideal");
  openScheduleModal(date, "actual", ideal.blocks.map((block) => ({ ...block, achievementPercent: 80 })));
}

function closeScheduleModal() {
  document.getElementById("schedule-modal").classList.remove("open");
  document.getElementById("schedule-modal").setAttribute("aria-hidden", "true");
}

function bindGlobalActions() {
  document.querySelectorAll("[data-close-sheet]").forEach((button) => button.addEventListener("click", closeSheet));
  document.querySelectorAll("[data-close-schedule-modal]").forEach((button) => button.addEventListener("click", closeScheduleModal));
  document.getElementById("add-class-ai-job").addEventListener("click", () => {
    if (!state.activeClass) return;
    state.jobs.unshift({
      id: crypto.randomUUID(),
      job_type: "generate_questions",
      source_type: "class_material",
      status: "pending",
      created_at: nowLabel(),
      related_class: {
        date: state.activeClass.date,
        weekday: state.activeClass.weekday,
        period: state.activeClass.period,
        subject: state.activeClass.subject,
        teacher: state.activeClass.teacher,
      },
      input_text: `${state.activeClass.date} ${state.activeClass.period}限 ${state.activeClass.subject}`,
      result_json: null,
      error_message: null,
    });
    saveState(STORAGE.jobs, state.jobs);
    closeSheet();
    renderAll();
    showToast("AI処理待ちに追加しました");
  });
  document.querySelectorAll("[data-class-upload]").forEach((input) => {
    input.addEventListener("change", () => handleClassUpload(input));
  });
}

function bindTodoCheckboxes(root) {
  root.querySelectorAll("[data-todo-check]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      state.todos = state.todos.map((todo) => (todo.id === checkbox.dataset.todoCheck ? { ...todo, completed: checkbox.checked } : todo));
      saveState(STORAGE.todos, state.todos);
      renderAll();
    });
  });
}

function bindClassCards(root) {
  root.querySelectorAll("[data-class-key]").forEach((card) => {
    card.addEventListener("click", () => {
      const [date, weekday, period] = card.dataset.classKey.split("|");
      const entry = DATA.timetable.find((item) => String(item.weekday) === weekday && String(item.period) === period);
      openClassSheet({ ...entry, date });
    });
  });
}

function bindRouteButtons(root) {
  root.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.route)));
}

function bindCalendarJumpButtons(root) {
  root.querySelectorAll("[data-calendar-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      state.route = "calendar";
      state.selectedDate = state.homeDate;
      state.calendarTab = button.dataset.calendarJump;
      renderAll();
    });
  });
}

function openClassSheet(entry) {
  state.activeClass = entry;
  const relatedJobs = classJobs(entry);
  document.getElementById("sheet-period").textContent = `${formatShortDate(entry.date)} / ${entry.period}限`;
  document.getElementById("sheet-title").textContent = entry.subject;
  document.getElementById("sheet-meta").innerHTML = `
    <p><strong>先生：</strong>${entry.teacher || "未設定"}</p>
    <p><strong>教室：</strong>${entry.room || "未設定"}</p>
    ${entry.needs_review ? "<p><strong>確認：</strong>読み取りに確認が必要です。</p>" : ""}
    <div class="ai-status-box">
      <strong>AI処理状態</strong>
      <span>アップロード済み: ${relatedJobs.length}件</span>
      <span>pending: ${relatedJobs.filter((job) => job.status === "pending").length} / processing: ${relatedJobs.filter((job) => job.status === "processing").length} / completed: ${relatedJobs.filter((job) => job.status === "completed").length} / failed: ${relatedJobs.filter((job) => job.status === "failed").length}</span>
    </div>
    ${relatedJobs.map(renderClassJobResult).join("")}
  `;
  document.getElementById("class-sheet").classList.add("open");
  document.getElementById("class-sheet").setAttribute("aria-hidden", "false");
}

async function handleClassUpload(input) {
  if (!state.activeClass || !input.files || !input.files.length) return;
  const file = input.files[0];
  const kind = input.dataset.classUpload;
  try {
    showToast("AI jobを作成中です");
    const job = await buildClassUploadJob(file, kind, state.activeClass);
    state.jobs.unshift(job);
    saveState(STORAGE.jobs, state.jobs);
    openClassSheet(state.activeClass);
    renderImportCenter();
    showToast("pending jobを作成しました。AI jobsを書き出してworkerで処理してください");
  } catch (error) {
    showToast(`AI jobを作成できませんでした: ${error.message}`);
  } finally {
    input.value = "";
  }
}

async function buildClassUploadJob(file, kind, classInfo) {
  const dataUrl = await fileToDataUrl(file);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  return {
    id: `job_${crypto.randomUUID()}`,
    job_type: kind === "print" ? "analyze_print_image" : kind === "note" ? "analyze_note_image" : "analyze_board_image",
    source_type: isPdf ? "pdf" : "image",
    status: "pending",
    created_at: new Date().toISOString(),
    file_name: file.name,
    file_type: file.type || (isPdf ? "application/pdf" : "application/octet-stream"),
    file_size: file.size,
    file_data_url: dataUrl,
    related_subject: classInfo.subject,
    related_date: classInfo.date,
    related_period: classInfo.period,
    related_class: {
      date: classInfo.date,
      weekday: classInfo.weekday,
      period: classInfo.period,
      subject: classInfo.subject,
      teacher: classInfo.teacher,
    },
    uploaded_file: {
      name: file.name,
      size: file.size,
      type: file.type || "unknown",
    },
    material_type: kind,
    input_text: "",
    ocr_result: null,
    layout_blocks: [],
    result_json: null,
    error_message: null,
  };
}

function classJobs(entry) {
  return state.jobs.filter((job) => {
    const related = job.related_class;
    return related && related.date === entry.date && related.period === entry.period && related.subject === entry.subject;
  });
}

function renderClassJobResult(job) {
  const result = job.result_json;
  const ocrText = job.ocr_result?.layout_text || job.ocr_result?.text || job.input_text || "";
  const questions = result?.questions || [];
  return `
    <div class="class-job-result">
      <strong>${job.uploaded_file?.name || job.job_type}</strong>
      <small>${job.source_type} / ${job.status} / ${job.material_type || "material"}</small>
      ${job.file_data_url && job.source_type === "image" ? `<img class="uploaded-preview" src="${job.file_data_url}" alt="${escapeAttr(job.file_name || "アップロード画像")}" />` : ""}
      ${job.source_type === "pdf" ? `<p class="note-text">PDF: ${escapeHtml(job.file_name || job.uploaded_file?.name || "")}</p>` : ""}
      <div class="ai-status-box">
        <strong>AI処理状態</strong>
        <span>${job.status}</span>
        ${job.error_message ? `<span class="job-error">${escapeHtml(job.error_message)}</span>` : ""}
      </div>
      ${ocrText ? `
        <details class="job-detail-block">
          <summary>OCR結果</summary>
          <pre>${escapeHtml(ocrText.slice(0, 3000))}</pre>
        </details>
      ` : `<p class="note-text">OCR結果はworker処理後に表示されます。</p>`}
      ${result?.summary ? `<p><strong>要約</strong><br>${escapeHtml(result.summary)}</p>` : ""}
      ${(result?.important_points || []).length ? `<p><strong>重要ポイント</strong></p><ul>${result.important_points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
      ${questions.length ? `<p><strong>生成問題</strong></p>${questions.map(renderGeneratedQuestion).join("")}` : ""}
    </div>
  `;
}

function closeSheet() {
  document.getElementById("class-sheet").classList.remove("open");
  document.getElementById("class-sheet").setAttribute("aria-hidden", "true");
}

async function enqueueImportJob(view) {
  const kind = view.querySelector("#import-kind").value;
  const effectiveInput = view.querySelector("#effective-from");
  if (kind === "timetable_change" && !effectiveInput.value) {
    showToast("時間割変更は反映開始日が必須です");
    effectiveInput.focus();
    return;
  }
  const file = view.querySelector("#file-input")?.files?.[0] || null;
  const fileData = file ? await fileToDataUrl(file) : null;
  const isPdf = file ? file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") : false;
  const job = {
    id: `job_${crypto.randomUUID()}`,
    job_type: `import_${kind}`,
    source_type: file ? (isPdf ? "pdf" : "image") : "manual",
    status: "pending",
    created_at: new Date().toISOString(),
    effective_from: effectiveInput?.value || null,
    grade_filter: view.querySelector("#grade-filter")?.value || null,
    file_name: file?.name || null,
    file_type: file?.type || null,
    file_size: file?.size || null,
    file_data_url: fileData,
    input_text: "",
    ocr_result: null,
    layout_blocks: [],
    result_json: null,
    error_message: null,
  };
  state.jobs.unshift(job);
  saveState(STORAGE.jobs, state.jobs);
  renderAll();
  showToast("pendingジョブとして保存しました");
}

function renderReviewPanel(kind) {
  const panel = document.getElementById("review-panel");
  const body = kind === "timetable_change"
    ? `
      <p>AIはこのファイルを「時間割変更」と判断しました。</p>
      <p><strong>反映開始日：</strong>入力された日付を使用</p>
      <ul>
        <li>月曜1限 LHR → 数学C</li>
        <li>火曜3限 英コIII → 体育</li>
        <li>金曜6限 探究 → 文化祭準備</li>
      </ul>
    `
    : kind === "annual_schedule"
      ? `
        <p>対象学年フィルタ: <strong>高校3年のみ</strong></p>
        <ul>
          <li>1年生だけ・2年生だけの予定は除外</li>
          <li>3年生対象、全学年共通、寮・休業日は候補に残す</li>
        </ul>
      `
      : `<p>解析結果はここで確認し、勝手に反映しません。</p>`;
  panel.innerHTML = `
    ${body}
    <div class="button-row">
      <button class="secondary-action" type="button">全部反映</button>
      <button class="ghost-button" type="button">一部修正</button>
      <button class="ghost-button" type="button">無視</button>
    </div>
  `;
}

function downloadJobs() {
  const blob = new Blob([JSON.stringify({ jobs: state.jobs }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jobs.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importJobs(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const imported = Array.isArray(parsed.jobs) ? parsed.jobs : normalizeResultsFile(parsed);
      const byId = new Map(state.jobs.map((job) => [job.id, job]));
      imported.forEach((job) => byId.set(job.id, { ...(byId.get(job.id) || {}), ...job }));
      state.jobs = Array.from(byId.values()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      saveState(STORAGE.jobs, state.jobs);
      renderAll();
      showToast("AI結果を読み込みました");
    } catch {
      showToast("AI結果JSONを読み込めませんでした");
    }
  };
  reader.readAsText(file);
}

function normalizeResultsFile(parsed) {
  if (Array.isArray(parsed.results)) {
    return parsed.results.map((result) => ({
      id: result.job_id || result.id,
      status: result.status || "completed",
      processed_at: result.processed_at || new Date().toISOString(),
      input_text: result.input_text || "",
      ocr_result: result.ocr_result || null,
      layout_blocks: result.layout_blocks || result.ocr_result?.blocks || [],
      result_json: result.result_json || result,
      error_message: result.error_message || null,
    })).filter((job) => job.id);
  }
  if (parsed.job_id || parsed.id) {
    return normalizeResultsFile({ results: [parsed] });
  }
  return [];
}

function jobCounts() {
  return state.jobs.reduce((counts, job) => {
    counts[job.status] = (counts[job.status] || 0) + 1;
    return counts;
  }, { pending: 0, processing: 0, completed: 0, failed: 0 });
}

function renderTodoItem(todo) {
  const badges = [
    todo.countdownEnabled ? "カウントダウン" : null,
    todo.showOnCalendar ? "カレンダー" : null,
    todo.repeat && todo.repeat !== "なし" ? `繰り返し: ${todo.repeat}` : null,
  ].filter(Boolean).join(" / ");
  return `
    <label class="todo-item ${todo.completed ? "completed" : ""}">
      <input data-todo-check="${todo.id}" type="checkbox" ${todo.completed ? "checked" : ""} />
      <span>
        <span class="todo-title">${todo.title}</span>
        <span class="todo-meta">${todo.subject} / ${todo.kind || "Todo"} / 期限 ${formatMonthDay(todo.dueDate)}${badges ? ` / ${badges}` : ""}</span>
      </span>
    </label>
  `;
}

function renderVerticalClassCard(entry, date = state.homeDate) {
  return `
    <button class="class-row" data-class-key="${date}|${entry.weekday}|${entry.period}" type="button">
      <span class="period-badge">${entry.period}限</span>
      <span><strong>${entry.subject}</strong><small>先生: ${entry.teacher || "未設定"} / 教室: ${entry.room || "未設定"}</small></span>
      <span class="upload-mini">写真/PDF</span>
    </button>
  `;
}

function renderTimetableCell(date, period) {
  const weekday = dayOfWeekMondayBase(date);
  const entry = DATA.timetable.find((item) => item.weekday === weekday && item.period === period);
  if (!entry) return `<td class="class-cell empty"><span>—</span></td>`;
  return `
    <td>
      <button class="class-cell" data-class-key="${date}|${weekday}|${period}" type="button">
        <strong>${entry.subject}</strong>
        <span>${entry.teacher || "未設定"}</span>
        ${entry.needs_review ? '<em>確認</em>' : ""}
      </button>
    </td>
  `;
}

function renderEventCard(event) {
  return `<div class="event-card type-${event.event_type}"><strong>${dateRangeLabel(event)} ${event.title}</strong><small>${event.event_type}${event.needs_review ? " / needs_review" : ""}</small></div>`;
}

function renderCountdown(event) {
  const targetDate = event.start_date || event.dueDate;
  const days = dayDiff(DATA.today, targetDate);
  return `<div class="countdown-item"><strong>あと${days}日</strong><span>${event.title}</span><small>${event.subject ? "Todo" : event.event_type}</small></div>`;
}

function renderMenu(menu) {
  return `
    <div class="menu-block">
      <div class="meal"><strong>朝</strong><span>${menu.breakfast}</span></div>
      <div class="meal"><strong>昼</strong><span>${menu.lunch}</span></div>
      <div class="meal"><strong>夕</strong><span>${menu.dinner}</span></div>
      <div class="meal"><strong>kcal</strong><span>${menu.kcal || "未設定"}${menu.event_note ? ` / ${menu.event_note}` : ""}</span></div>
    </div>
  `;
}

function renderMetric(category, ideal, actual) {
  const meta = DATA.categories[category];
  return `<div class="metric"><span>${meta.label}</span><strong>${hoursFor(ideal, category)}h → ${hoursFor(actual, category)}h</strong></div>`;
}

function renderBlockEditor(block, index, planType) {
  return `
    <div class="block-editor" data-block-index="${index}">
      <select data-field="category">${Object.entries(DATA.categories).map(([key, meta]) => `<option value="${key}" ${block.category === key ? "selected" : ""}>${meta.label}</option>`).join("")}</select>
      <input data-field="label" value="${escapeAttr(block.label)}" />
      <input data-field="startTime" type="time" value="${block.startTime}" />
      <input data-field="endTime" type="time" value="${block.endTime}" />
      ${planType === "actual" ? `<input data-field="achievementPercent" type="number" min="0" max="100" value="${block.achievementPercent ?? 80}" aria-label="達成度" />` : ""}
      <button data-delete-block class="icon-button" type="button">削除</button>
    </div>
  `;
}

function renderPie(targetId, blocks, label) {
  const target = document.getElementById(targetId);
  const normalized = normalizeBlocks(blocks);
  const sectors = normalized.map((block) => renderClockSector(block)).join("");
  const hourTicks = Array.from({ length: 24 }, (_, hour) => renderHourTick(hour)).join("");
  const labels = normalized.map((block) => renderClockLabel(block)).join("");
  target.innerHTML = `
    <svg class="clock-chart" viewBox="0 0 260 260" role="img" aria-label="24時間${label}スケジュール">
      <circle cx="130" cy="130" r="116" fill="#fff" stroke="#dbe3ea" stroke-width="1"></circle>
      ${sectors}
      <circle cx="130" cy="130" r="48" fill="#fff" stroke="#dbe3ea" stroke-width="1"></circle>
      ${hourTicks}
      ${labels}
      <text x="130" y="124" text-anchor="middle" class="clock-title">24h</text>
      <text x="130" y="145" text-anchor="middle" class="clock-subtitle">${label}</text>
    </svg>
  `;
}

function renderClockSector(block) {
  const start = timeToMinutes(block.startTime);
  const end = start + block.durationMinutes;
  const color = DATA.categories[block.category].color;
  const parts = end <= 1440
    ? [[start, end]]
    : [[start, 1440], [0, end - 1440]];
  return parts.map(([partStart, partEnd]) => {
    const large = partEnd - partStart > 720 ? 1 : 0;
    const outerStart = polar(130, 130, 112, minuteAngle(partStart));
    const outerEnd = polar(130, 130, 112, minuteAngle(partEnd));
    const innerEnd = polar(130, 130, 54, minuteAngle(partEnd));
    const innerStart = polar(130, 130, 54, minuteAngle(partStart));
    return `<path d="M ${outerStart.x} ${outerStart.y} A 112 112 0 ${large} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A 54 54 0 ${large} 0 ${innerStart.x} ${innerStart.y} Z" fill="${color}" opacity="0.92"></path>`;
  }).join("");
}

function renderHourTick(hour) {
  const angle = minuteAngle(hour * 60);
  const outer = polar(130, 130, 124, angle);
  const inner = polar(130, 130, hour % 3 === 0 ? 114 : 119, angle);
  const text = polar(130, 130, 101, angle);
  return `
    <line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" class="clock-tick"></line>
    ${hour % 3 === 0 ? `<text x="${text.x}" y="${text.y + 3}" text-anchor="middle" class="clock-hour">${hour}</text>` : ""}
  `;
}

function renderClockLabel(block) {
  if (block.durationMinutes < 45) return "";
  const mid = timeToMinutes(block.startTime) + block.durationMinutes / 2;
  const point = polar(130, 130, block.durationMinutes > 180 ? 82 : 88, minuteAngle(mid % 1440));
  const text = block.durationMinutes > 150 ? block.label : block.label.slice(0, 3);
  return `<text x="${point.x}" y="${point.y}" text-anchor="middle" class="clock-label">${text}</text>`;
}

function minuteAngle(minutes) {
  return (minutes / 1440) * 360 - 90;
}

function polar(cx, cy, radius, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: Number((cx + radius * Math.cos(angle)).toFixed(2)),
    y: Number((cy + radius * Math.sin(angle)).toFixed(2)),
  };
}

function renderLegend(targetId, blocks) {
  const target = document.getElementById(targetId);
  target.innerHTML = normalizeBlocks(blocks)
    .map((block) => `<div class="legend-item"><span class="legend-swatch" style="background:${DATA.categories[block.category].color}"></span><span><strong>${block.label}</strong>${block.startTime}〜${block.endTime}</span></div>`)
    .join("");
}

function renderMonthDay(day) {
  const events = eventsOnDate(day.date);
  return `
    <button class="month-day ${day.inMonth ? "" : "outside"} ${day.date === DATA.today ? "today" : ""}" data-date="${day.date}" type="button">
      <span class="day-number">${Number(day.date.slice(8, 10))}</span>
      <span class="day-events">
        ${events.slice(0, 3).map((event) => `<span class="month-chip type-${event.event_type}">${event.title}</span>`).join("")}
        ${events.length > 3 ? `<span class="more-chip">+${events.length - 3}件</span>` : ""}
      </span>
    </button>
  `;
}

function renderMiniMonth(year, month) {
  const days = monthGrid(year, month);
  return `
    <button class="mini-month" data-month="${month}" type="button">
      <strong>${month}月</strong>
      <span class="mini-grid">
        ${days.map((day) => {
          const hasEvents = eventsOnDate(day.date).length > 0;
          return `<span class="${day.inMonth ? "" : "outside"} ${day.date === DATA.today ? "today-dot" : ""} ${hasEvents ? "has-event" : ""}">${day.inMonth ? Number(day.date.slice(8, 10)) : ""}</span>`;
        }).join("")}
      </span>
    </button>
  `;
}

function renderJob(job) {
  return `
    <div class="job-item">
      <strong>${job.job_type}</strong>
      <small>${job.status} / ${job.created_at}${job.effective_from ? ` / 反映 ${job.effective_from}` : ""}</small>
      ${job.error_message ? `<p class="job-error">${job.error_message}</p>` : ""}
      ${job.result_json ? renderJobResult(job.result_json) : ""}
    </div>
  `;
}

function renderJobResult(result) {
  if (result.summary || result.important_points || result.questions) {
    return `
      <div class="job-result">
        ${result.summary ? `<p><strong>要約</strong><br>${escapeHtml(result.summary)}</p>` : ""}
        ${(result.important_points || []).length ? `<p><strong>重要ポイント</strong></p><ul>${result.important_points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
        ${(result.questions || []).length ? `<p><strong>生成問題</strong></p>${result.questions.map(renderGeneratedQuestion).join("")}` : ""}
      </div>
    `;
  }
  return `<pre class="job-json">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
}

function renderGeneratedQuestion(question, index) {
  return `
    <div class="generated-question">
      <strong>${index + 1}. ${escapeHtml(question.question || "")}</strong>
      ${(question.choices || []).length ? `<ol type="A">${question.choices.map((choice) => `<li>${escapeHtml(String(choice).replace(/^[A-D]\)\s*/, ""))}</li>`).join("")}</ol>` : ""}
      <small>答え: ${escapeHtml(question.answer || "")}</small>
      ${question.explanation ? `<small>解説: ${escapeHtml(question.explanation)}</small>` : ""}
    </div>
  `;
}

function emptyText(text) {
  return `<p class="empty-text">${text}</p>`;
}

function seedPlans() {
  const schoolDay = DATA.scheduleTemplates[0].blocks;
  const actual = schoolDay.map((block) => ({ ...block, achievementPercent: block.category === "study" ? 70 : 90 }));
  return {
    [`${DATA.today}:ideal`]: { date: DATA.today, planType: "ideal", blocks: normalizeBlocks(schoolDay) },
    [`${DATA.today}:actual`]: { date: DATA.today, planType: "actual", blocks: normalizeBlocks(actual) },
  };
}

function getPlan(date, planType) {
  return state.plans[`${date}:${planType}`] || {
    date,
    planType,
    blocks: normalizeBlocks(DATA.scheduleTemplates[0].blocks.map((block) => ({ ...block, achievementPercent: planType === "actual" ? 80 : undefined }))),
  };
}

function normalizeBlocks(blocks) {
  return blocks
    .map((block, index) => ({
      id: block.id || crypto.randomUUID(),
      category: block.category || "other",
      label: block.label || DATA.categories[block.category || "other"].label,
      startTime: block.startTime,
      endTime: block.endTime,
      durationMinutes: durationMinutes(block.startTime, block.endTime),
      achievementPercent: block.achievementPercent,
      sortOrder: index,
    }))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

function cloneBlocks(blocks) {
  return blocks.map((block) => ({ ...block, id: crypto.randomUUID() }));
}

function conicSegments(blocks) {
  const raw = blocks.flatMap((block) => {
    const start = (timeToMinutes(block.startTime) / 1440) * 100;
    const end = start + (block.durationMinutes / 1440) * 100;
    const color = DATA.categories[block.category].color;
    return end <= 100 ? [{ color, start, end }] : [{ color, start, end: 100 }, { color, start: 0, end: end - 100 }];
  }).sort((a, b) => a.start - b.start);
  const filled = [];
  let cursor = 0;
  raw.forEach((segment) => {
    if (segment.start > cursor) filled.push({ color: DATA.categories.other.color, start: cursor, end: segment.start });
    filled.push(segment);
    cursor = Math.max(cursor, segment.end);
  });
  if (cursor < 100) filled.push({ color: DATA.categories.other.color, start: cursor, end: 100 });
  return filled;
}

function eventsOnDate(date) {
  const target = parseDate(date);
  return DATA.events.filter((event) => target >= parseDate(event.start_date) && target <= parseDate(event.end_date));
}

function todosForDate(date) {
  return state.todos.filter((todo) => isTodoActiveOn(todo, date));
}

function timetableForDate(date) {
  const weekday = dayOfWeekMondayBase(date);
  return DATA.timetable.filter((entry) => entry.weekday === weekday);
}

function menuForDate(date) {
  return DATA.menus[date] || {
    breakfast: "未登録",
    lunch: "未登録",
    dinner: "未登録",
    kcal: "",
    raw_text: "",
  };
}

function getCountdowns(fromDate) {
  const eventCountdowns = DATA.events
    .filter((event) => event.countdown_enabled && parseDate(event.start_date) >= parseDate(fromDate))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const todoCountdowns = state.todos
    .filter((todo) => todo.countdownEnabled && !todo.completed && parseDate(todo.dueDate) >= parseDate(fromDate))
    .map((todo) => ({ ...todo, start_date: todo.dueDate, event_type: "todo_countdown" }));
  return [...eventCountdowns, ...todoCountdowns].sort((a, b) => (a.start_date || a.dueDate).localeCompare(b.start_date || b.dueDate));
}

function isTodoActiveOn(todo, date) {
  if (todo.dueDate === date) return true;
  if (!todo.showOnCalendar || !todo.repeat || todo.repeat === "なし") return false;
  const target = parseDate(date);
  const start = parseDate(todo.dueDate);
  if (target < start) return false;
  if (todo.repeatWeekday !== "" && todo.repeatWeekday != null && String(target.getDay()) !== String(todo.repeatWeekday)) return false;
  const diff = dayDiff(todo.dueDate, date);
  if (todo.repeat === "毎週") return diff % 7 === 0 || String(target.getDay()) === String(todo.repeatWeekday);
  if (todo.repeat === "隔週") return diff % 14 === 0;
  if (todo.repeat === "毎月") return target.getDate() === start.getDate();
  return false;
}

function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: toDateKey(date), inMonth: date.getMonth() + 1 === month };
  });
}

function weekDates(date) {
  const base = parseDate(date);
  const mondayOffset = (base.getDay() + 6) % 7;
  const monday = new Date(base);
  monday.setDate(base.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + index);
    return toDateKey(d);
  });
}

function shiftMonth(delta) {
  const date = new Date(state.selectedYear, state.selectedMonth - 1 + delta, 1);
  state.selectedYear = date.getFullYear();
  state.selectedMonth = date.getMonth() + 1;
  renderCalendar();
}

function goDay(date) {
  state.selectedDate = date;
  state.selectedYear = Number(date.slice(0, 4));
  state.selectedMonth = Number(date.slice(5, 7));
  state.calendarTab = "day";
  renderCalendar();
}

function calendarTabLabel(tab) {
  return { day24: "24時間", day: "日", week: "週", month: "月", year: "年" }[tab];
}

function weekdayLabel(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][parseDate(date).getDay()];
}

function dayOfWeekMondayBase(date) {
  const day = parseDate(date).getDay();
  return day === 0 ? 7 : day;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(parseDate(date));
}

function formatShortDate(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function formatMonthDay(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function dateRangeLabel(event) {
  return event.start_date === event.end_date ? formatMonthDay(event.start_date) : `${formatMonthDay(event.start_date)}〜${formatMonthDay(event.end_date)}`;
}

function hoursFor(blocks, category) {
  return (blocks.filter((block) => block.category === category).reduce((sum, block) => sum + block.durationMinutes, 0) / 60).toFixed(1);
}

function achievement(blocks) {
  const actual = blocks.filter((block) => typeof block.achievementPercent === "number");
  if (!actual.length) return 0;
  const total = actual.reduce((sum, block) => sum + block.durationMinutes, 0);
  return Math.round(actual.reduce((sum, block) => sum + block.durationMinutes * block.achievementPercent, 0) / total);
}

function durationMinutes(start, end) {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return e > s ? e - s : 1440 - s + e;
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function parseDate(date) {
  return new Date(`${date}T00:00:00+09:00`);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDate(date, days) {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function dayDiff(from, to) {
  return Math.ceil((parseDate(to) - parseDate(from)) / 86400000);
}

function nowLabel() {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date());
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("ファイルを読み込めませんでした"));
    reader.readAsDataURL(file);
  });
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function loadState(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveState(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function icon(name) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3V10.5Z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M4 8h16M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H21"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H21v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1 .6 1.8 1.8 0 0 0-.5 1.3V21a2 2 0 1 1-4 0v-.08A1.8 1.8 0 0 0 8.4 19.4a1.8 1.8 0 0 0-1.98.36l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.3-1H3a2 2 0 1 1 0-4h.08A1.8 1.8 0 0 0 4.6 8.4a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1-.6 1.8 1.8 0 0 0 .5-1.3V3a2 2 0 1 1 4 0v.08A1.8 1.8 0 0 0 15.6 4.6a1.8 1.8 0 0 0 1.98-.36l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.8 1.8 0 0 0 19.4 9c.18.5.55.9 1.05 1H21a2 2 0 1 1 0 4h-.08A1.8 1.8 0 0 0 19.4 15Z"/></svg>',
  };
  return icons[name] || icons.home;
}
