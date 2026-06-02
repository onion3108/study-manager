const DATA = window.STUDY_DATA;
const STORAGE = {
  todos: "study-manager-v2-todos",
  plans: "study-manager-v2-plans",
  jobs: "study-manager-v2-jobs",
  events: "study-manager-v2-events",
  menus: "study-manager-v2-menus",
  timetable: "study-manager-v2-timetable",
  settings: "study-manager-v2-settings",
  studyLogs: "study-manager-v2-study-logs",
  subjectProgress: "study-manager-v2-subject-progress",
  understandingScores: "study-manager-v2-understanding-scores",
};

const SUPABASE_CONFIG = window.STUDY_MANAGER_SUPABASE || {};
const SUPABASE_BUCKET = SUPABASE_CONFIG.storageBucket || "study-files";
let supabaseClient = null;
let syncSaveTimer = null;
let isApplyingRemote = false;
let syncChannel = null;

let syncState = {
  configured: false,
  status: "offline",
  user: null,
  message: "Supabase未設定",
  lastJob: null,
  lastWorkerAt: null,
  lastUploadResult: null,
  lastAiJobResult: null,
  lastError: null,
  lastStorageCheck: null,
};

const routes = [
  { id: "home", label: "ホーム", icon: "home" },
  { id: "calendar", label: "カレンダー", icon: "calendar" },
  { id: "todo", label: "Todo", icon: "check" },
  { id: "questions", label: "問題", icon: "book" },
  { id: "import", label: "AI取り込み", icon: "upload" },
  { id: "settings", label: "設定", icon: "settings" },
];

DATA.today = getTodayKey();

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
  events: loadState(STORAGE.events, DATA.events),
  menus: { ...DATA.menus, ...loadState(STORAGE.menus, DATA.menus) },
  timetable: loadState(STORAGE.timetable, DATA.timetable),
  studyLogs: loadState(STORAGE.studyLogs, []),
  subjectProgress: loadState(STORAGE.subjectProgress, []),
  understandingScores: loadState(STORAGE.understandingScores, []),
  activeClass: null,
  scheduleDraft: null,
  ocrDraft: null,
  settings: loadState(STORAGE.settings, {
    ollamaModel: "elyza:jp8b",
    ocrLanguage: "japan",
    defaultQuestionCount: 10,
  }),
};

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  renderAll();
  bindGlobalActions();
  initSupabase();
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

async function initSupabase() {
  syncState.configured = Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && window.supabase);
  if (!syncState.configured) {
    syncState.status = "offline";
    syncState.message = "supabase-config.jsにURLとanon keyを設定してください";
    syncState.lastError = {
      context: "supabase-config.js未設定",
      message: "Supabase URL、anonKey、またはsupabase-jsが読み込めていません",
      code: "",
      details: "",
      hint: "supabase-config.jsとindex.htmlのscript読み込みを確認してください",
      at: new Date().toISOString(),
    };
    renderAll();
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  const { data } = await supabaseClient.auth.getSession();
  syncState.user = data.session?.user || null;
  syncState.status = syncState.user ? "online" : "signed_out";
  syncState.message = syncState.user ? "Supabase同期中" : "ログインしてください";
  if (syncState.user) await loadSupabaseData();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    syncState.user = session?.user || null;
    syncState.status = syncState.user ? "online" : "signed_out";
    syncState.message = syncState.user ? "Supabase同期中" : "ログインしてください";
    if (syncState.user) {
      subscribeSupabaseChanges();
      await loadSupabaseData();
    }
    renderAll();
  });
  subscribeSupabaseChanges();
  renderAll();
}

function isSupabaseReady() {
  return Boolean(supabaseClient && syncState.user);
}

async function signInWithEmail(email) {
  if (!supabaseClient) {
    showToast("Supabaseが未設定です");
    return;
  }
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) {
    showToast(`ログインメール送信に失敗: ${error.message}`);
  } else {
    showToast("ログイン用メールを送信しました。メール内のリンクを開いてください");
  }
}

async function signOutSupabase() {
  if (!supabaseClient) return;
  if (syncChannel) {
    supabaseClient.removeChannel(syncChannel);
    syncChannel = null;
  }
  await supabaseClient.auth.signOut();
  syncState.user = null;
  syncState.status = "signed_out";
  syncState.message = "ログアウトしました";
  renderAll();
}

async function loadSupabaseData() {
  if (!isSupabaseReady()) return;
  isApplyingRemote = true;
  try {
    const userId = syncState.user.id;
    const [{ data: appRows }, { data: todoRows }, { data: jobRows }, { data: resultRows }] = await Promise.all([
      supabaseClient.from("app_settings").select("*").eq("user_id", userId).eq("key", "app_state").maybeSingle(),
      supabaseClient.from("todos").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabaseClient.from("ai_jobs").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabaseClient.from("ai_results").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);
    const hasRemoteAppState = Boolean(appRows?.app_state);
    const hasRemoteTodos = Boolean(todoRows?.length);
    const appState = appRows?.app_state || {};
    if (appState.todos) state.todos = appState.todos;
    if (appState.plans) state.plans = appState.plans;
    if (appState.events) state.events = appState.events;
    if (appState.menus) state.menus = { ...DATA.menus, ...appState.menus };
    if (appState.timetable) state.timetable = appState.timetable;
    if (appState.studyLogs) state.studyLogs = appState.studyLogs;
    if (appState.subjectProgress) state.subjectProgress = appState.subjectProgress;
    if (appState.understandingScores) state.understandingScores = appState.understandingScores;
    if (appRows?.settings) state.settings = { ...state.settings, ...appRows.settings };
    if (todoRows?.length) state.todos = todoRows.map(dbTodoToState);
    state.jobs = await hydrateJobSignedUrls(mapAiJobs(jobRows || [], resultRows || []));
    syncState.lastJob = state.jobs[0] || null;
    syncState.lastWorkerAt = state.jobs.find((job) => job.worker_processed_at)?.worker_processed_at || null;
    cacheAllState();
    if (!hasRemoteAppState && !hasRemoteTodos) {
      await persistSupabaseNow();
    }
    syncState.status = "online";
    syncState.message = "Supabaseから同期しました";
  } catch (error) {
    syncState.status = "error";
    syncState.message = error.message;
    recordSupabaseError("Supabase同期エラー", error);
    showToast(`Supabase同期エラー: ${error.message}`);
  } finally {
    isApplyingRemote = false;
    renderAll();
  }
}

function subscribeSupabaseChanges() {
  if (!supabaseClient || !syncState.user) return;
  if (syncChannel) {
    supabaseClient.removeChannel(syncChannel);
    syncChannel = null;
  }
  syncChannel = supabaseClient
    .channel(`study-manager-${syncState.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "todos", filter: `user_id=eq.${syncState.user.id}` }, () => loadSupabaseData())
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings", filter: `user_id=eq.${syncState.user.id}` }, () => loadSupabaseData())
    .on("postgres_changes", { event: "*", schema: "public", table: "ai_jobs", filter: `user_id=eq.${syncState.user.id}` }, () => loadSupabaseData())
    .on("postgres_changes", { event: "*", schema: "public", table: "ai_results", filter: `user_id=eq.${syncState.user.id}` }, () => loadSupabaseData())
    .subscribe();
}

function cacheAllState() {
  saveLocalState(STORAGE.todos, state.todos);
  saveLocalState(STORAGE.plans, state.plans);
  saveLocalState(STORAGE.jobs, state.jobs);
  saveLocalState(STORAGE.events, state.events);
  saveLocalState(STORAGE.menus, state.menus);
  saveLocalState(STORAGE.timetable, state.timetable);
  saveLocalState(STORAGE.studyLogs, state.studyLogs);
  saveLocalState(STORAGE.subjectProgress, state.subjectProgress);
  saveLocalState(STORAGE.understandingScores, state.understandingScores);
  saveLocalState(STORAGE.settings, state.settings);
}

function buildAppSnapshot() {
  return {
    todos: state.todos,
    plans: state.plans,
    jobs: state.jobs,
    events: state.events,
    menus: state.menus,
    timetable: state.timetable,
    settings: state.settings,
    studyLogs: state.studyLogs,
    subjectProgress: state.subjectProgress,
    understandingScores: state.understandingScores,
    updatedAt: new Date().toISOString(),
  };
}

function persistSupabaseSoon() {
  if (isApplyingRemote || !isSupabaseReady()) return;
  window.clearTimeout(syncSaveTimer);
  syncSaveTimer = window.setTimeout(persistSupabaseNow, 700);
}

async function persistSupabaseNow() {
  if (!isSupabaseReady()) return;
  try {
    const userId = syncState.user.id;
    await supabaseClient.from("app_settings").upsert({
      user_id: userId,
      key: "app_state",
      settings: state.settings,
      app_state: buildAppSnapshot(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,key" });
    await upsertTodosToSupabase(userId);
    syncState.status = "online";
    syncState.message = "Supabaseへ保存しました";
  } catch (error) {
    syncState.status = "error";
    syncState.message = error.message;
  }
}

async function upsertTodosToSupabase(userId) {
  if (!state.todos.length) return;
  const rows = state.todos.map((todo) => ({
    user_id: userId,
    client_id: todo.id,
    title: todo.title,
    description: todo.description || "",
    subject: todo.subject || "",
    due_date: todo.dueDate || todo.due_date || null,
    kind: todo.kind || "Todo",
    importance: todo.importance || "normal",
    completed: Boolean(todo.completed),
    countdown_enabled: Boolean(todo.countdownEnabled),
    repeat_rule: todo.repeat || "none",
    remind_3_days_before: Boolean(todo.remind3DaysBefore),
    remind_1_day_before: todo.remind1DayBefore !== false,
    remind_on_day: todo.remindOnDay !== false,
    show_on_calendar: todo.showOnCalendar !== false,
    raw: todo,
    updated_at: new Date().toISOString(),
  }));
  await supabaseClient.from("todos").upsert(rows, { onConflict: "user_id,client_id" });
}

function dbTodoToState(row) {
  return {
    ...(row.raw || {}),
    id: row.client_id || row.id,
    title: row.title,
    description: row.description,
    subject: row.subject,
    dueDate: row.due_date,
    kind: row.kind,
    importance: row.importance,
    completed: row.completed,
    countdownEnabled: row.countdown_enabled,
    repeat: row.repeat_rule,
    remind3DaysBefore: row.remind_3_days_before,
    remind1DayBefore: row.remind_1_day_before,
    remindOnDay: row.remind_on_day,
    showOnCalendar: row.show_on_calendar,
  };
}

function mapAiJobs(jobRows, resultRows) {
  const resultsByJob = new Map(resultRows.map((result) => [result.job_id, result]));
  return jobRows.map((row) => {
    const result = row.result_id ? resultRows.find((item) => item.id === row.result_id) : resultsByJob.get(row.id);
    const meta = row.metadata || {};
    return {
      ...(meta || {}),
      id: row.id,
      job_type: row.job_type,
      source_type: row.input_type || meta.source_type || "text",
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      worker_processed_at: row.worker_processed_at,
      error_message: row.error_message,
      ocr_result: row.ocr_layout && Object.keys(row.ocr_layout).length ? row.ocr_layout : row.ocr_text ? { text: row.ocr_text, layout_text: row.ocr_text } : meta.ocr_result || null,
      layout_blocks: row.ocr_layout?.blocks || meta.layout_blocks || [],
      input_text: row.input_text || "",
      result_id: row.result_id,
      model_name: row.model_name,
      file_path: row.file_path,
      file_url: row.file_url,
      file_name: meta.file_name || meta.uploaded_file?.name,
      related_subject: row.subject || meta.related_subject,
      related_date: meta.related_date,
      related_period: meta.related_period,
      related_class: meta.related_class,
      uploaded_file: meta.uploaded_file,
      material_type: meta.material_type,
      result_json: result ? {
        summary: result.summary,
        important_points: result.important_terms || [],
        questions: result.questions || [],
        answers: result.answers || [],
        understanding_data: result.understanding_data || {},
        ocr_layout: result.ocr_layout || null,
      } : null,
    };
  });
}

async function hydrateJobSignedUrls(jobs) {
  if (!supabaseClient || !jobs.length) return jobs;
  return Promise.all(jobs.map(async (job) => {
    if (!job.file_path || job.file_preview_url) return job;
    try {
      const { data, error } = await supabaseClient.storage.from(SUPABASE_BUCKET).createSignedUrl(job.file_path, 60 * 60);
      if (error) return job;
      return { ...job, file_preview_url: data?.signedUrl || job.file_url };
    } catch {
      return job;
    }
  }));
}

function sanitizeFileName(name) {
  return String(name || "upload.bin")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function requireSupabaseUser() {
  if (!supabaseClient) {
    recordSupabaseError("Supabase未設定", new Error("supabase-config.jsにURLとanon keyを設定してください"));
    showToast("supabase-config.jsにURLとanon keyを設定してください");
    return false;
  }
  if (!syncState.user) {
    recordSupabaseError("Supabase未ログイン", new Error("SupabaseにログインしてからAI依頼を作成してください"));
    showToast("SupabaseにログインしてからAI依頼を作成してください");
    return false;
  }
  if (!syncState.user.id) {
    recordSupabaseError("user.id未取得", new Error("ログインユーザーのuser.idを取得できません"));
    showToast("ログインユーザーのuser.idを取得できません");
    return false;
  }
  return true;
}

function inputTypeForFile(file) {
  if (!file) return "text";
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
}

function recordSupabaseError(context, error) {
  const message = supabaseErrorMessage(error);
  syncState.lastError = {
    context,
    message,
    code: error?.code || error?.statusCode || error?.status || "",
    details: error?.details || "",
    hint: error?.hint || "",
    at: new Date().toISOString(),
  };
  syncState.status = "error";
  syncState.message = `${context}: ${message}`;
}

function supabaseErrorMessage(error) {
  if (!error) return "不明なエラー";
  const raw = error.message || error.error_description || error.details || String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("row-level security") || lower.includes("rls") || lower.includes("policy")) {
    return `RLS policy violation: ${raw}`;
  }
  if (lower.includes("bucket") && lower.includes("not")) {
    return `Storage bucketがありません: ${raw}`;
  }
  if (lower.includes("column") || lower.includes("schema cache")) {
    return `DBカラム不一致: ${raw}`;
  }
  return raw;
}

function recordUploadResult(result) {
  syncState.lastUploadResult = {
    ...result,
    at: new Date().toISOString(),
  };
}

function recordAiJobResult(result) {
  syncState.lastAiJobResult = {
    ...result,
    at: new Date().toISOString(),
  };
}

function validateUploadPath(filePath, userId) {
  if (!filePath || !userId || !filePath.startsWith(`${userId}/`)) {
    throw new Error(`file_pathが不正です。Storage pathは {user_id}/{job_id}/{file_name} 形式にしてください: ${filePath || "空"}`);
  }
  const parts = filePath.split("/");
  if (parts.length < 3 || parts[0] !== userId || !parts[1] || !parts[2]) {
    throw new Error(`file_pathが不正です。1階層目はuser.id、2階層目はjob_id、3階層目はfile_nameが必要です: ${filePath}`);
  }
}

async function verifyStorageBucketAccess(userId) {
  try {
    const { data, error } = await supabaseClient.storage.from(SUPABASE_BUCKET).list(userId, { limit: 1 });
    if (error) throw error;
    syncState.lastStorageCheck = {
      ok: true,
      bucket: SUPABASE_BUCKET,
      checkedPath: userId,
      message: "Storage bucketへアクセスできます",
      itemCount: data?.length || 0,
      at: new Date().toISOString(),
    };
    return true;
  } catch (error) {
    syncState.lastStorageCheck = {
      ok: false,
      bucket: SUPABASE_BUCKET,
      checkedPath: userId,
      message: supabaseErrorMessage(error),
      at: new Date().toISOString(),
    };
    recordSupabaseError("Storage bucket確認失敗", error);
    throw error;
  }
}

async function createSupabaseAiJob({ file = null, jobType, subject = "", inputText = "", prompt = "", metadata = {} }) {
  if (!requireSupabaseUser()) throw new Error(syncState.lastError?.message || "Supabase未ログイン");
  const userId = syncState.user.id;
  const jobId = crypto.randomUUID();
  const inputType = inputTypeForFile(file);
  let filePath = null;
  let fileUrl = null;
  const now = new Date().toISOString();
  const fileMeta = file ? {
    name: file.name,
    size: file.size,
    type: file.type || (inputType === "pdf" ? "application/pdf" : "application/octet-stream"),
  } : null;

  if (file) {
    if (!(file instanceof File)) {
      const error = new Error("file inputからFileオブジェクトを取得できていません");
      recordSupabaseError("File取得失敗", error);
      throw error;
    }
    filePath = `${userId}/${jobId}/${sanitizeFileName(file.name)}`;
    validateUploadPath(filePath, userId);
    await verifyStorageBucketAccess(userId);
    try {
      const { error: uploadError } = await supabaseClient.storage.from(SUPABASE_BUCKET).upload(filePath, file, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: signedData, error: signedError } = await supabaseClient.storage.from(SUPABASE_BUCKET).createSignedUrl(filePath, 60 * 60);
      if (signedError) throw signedError;
      fileUrl = signedData?.signedUrl || null;
      recordUploadResult({
        ok: true,
        bucket: SUPABASE_BUCKET,
        file_path: filePath,
        file_url: fileUrl,
        file_name: file.name,
        file_size: file.size,
        input_type: inputType,
        message: "Storage upload succeeded",
      });
    } catch (error) {
      recordUploadResult({
        ok: false,
        bucket: SUPABASE_BUCKET,
        file_path: filePath,
        file_name: file.name,
        input_type: inputType,
        message: supabaseErrorMessage(error),
      });
      recordSupabaseError("Storage upload failed", error);
      throw error;
    }
  }

  const jobRow = {
    id: jobId,
    user_id: userId,
    job_type: jobType,
    subject,
    input_type: inputType,
    input_text: inputText,
    file_path: filePath,
    file_url: fileUrl,
    prompt,
    status: "pending",
    model_name: state.settings.ollamaModel,
    metadata: {
      ...metadata,
      source_type: inputType,
      uploaded_file: fileMeta,
      file_name: fileMeta?.name || null,
      file_type: fileMeta?.type || null,
      file_size: fileMeta?.size || null,
      source: metadata.source || "ai_import_center",
      created_from: "github_pages",
    },
    created_at: now,
    updated_at: now,
  };

  if (filePath && fileMeta) {
    try {
      const { error: fileError } = await supabaseClient.from("uploaded_files").insert({
        user_id: userId,
        storage_bucket: SUPABASE_BUCKET,
        file_path: filePath,
        file_url: fileUrl,
        file_name: fileMeta.name,
        file_type: fileMeta.type,
        file_size: fileMeta.size,
        related_subject: subject,
        related_date: metadata.related_date || metadata.related_class?.date || null,
        related_period: metadata.related_period || metadata.related_class?.period || null,
      });
      if (fileError) throw fileError;
    } catch (error) {
      recordSupabaseError("uploaded_files insert failed", error);
      throw error;
    }
  }

  let inserted = null;
  try {
    const { data, error: jobError } = await supabaseClient.from("ai_jobs").insert(jobRow).select("*").single();
    if (jobError) throw jobError;
    inserted = data;
    recordAiJobResult({
      ok: true,
      id: inserted.id,
      status: inserted.status,
      job_type: inserted.job_type,
      file_path: inserted.file_path,
      message: "ai_jobs pending insert succeeded",
    });
  } catch (error) {
    recordAiJobResult({
      ok: false,
      id: jobId,
      job_type: jobType,
      file_path: filePath,
      message: supabaseErrorMessage(error),
    });
    recordSupabaseError("ai_jobs insert failed", error);
    throw error;
  }

  const mapped = (await hydrateJobSignedUrls(mapAiJobs([inserted], [])))[0];
  syncState.lastJob = mapped;
  return mapped;
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
  const counts = jobCounts();
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
        <div class="todo-list compact-list home-todo-list">${todayTodos.map(renderTodoItem).join("") || emptyText("今日のTodoはありません")}</div>
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
        ${renderCompactMenu(menu)}
      </section>
      <section class="panel ai-home">
        <p class="section-kicker">AI処理</p>
        <h2>処理状況</h2>
        ${renderAiStatusCompact(counts)}
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
    showToast(isSupabaseReady() ? "Todoを追加しました。Supabaseへ同期します" : "Todoをローカル保存しました。同期にはSupabaseログインが必要です");
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
        <button id="refresh-supabase" class="ghost-button" type="button">Supabase再読み込み</button>
      </div>
    </div>
    ${renderSyncPanel()}
    <section class="panel ai-status-panel">
      <div class="status-grid">
        <div><span>AI実行</span><strong>PC側worker</strong></div>
        <div><span>保存</span><strong>Supabase</strong></div>
        <div><span>Model</span><strong id="ollama-model">${state.settings.ollamaModel}</strong></div>
        <div><span>処理待ち件数</span><strong>${counts.pending}</strong></div>
        <div><span>処理中件数</span><strong>${counts.processing}</strong></div>
        <div><span>処理完了件数</span><strong>${counts.completed}</strong></div>
        <div><span>失敗件数</span><strong>${counts.failed}</strong></div>
      </div>
      <div class="button-row">
        <a class="ghost-button as-link" href="./worker/README.md" target="_blank" rel="noreferrer">workerの使い方を見る</a>
      </div>
      <p class="note-text">GitHub Pages上ではOllama・PaddleOCR・localhostへ接続しません。AI依頼はSupabaseに保存し、PC側workerが処理します。</p>
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
  bindSyncPanel(view);
  view.querySelector("#refresh-supabase").addEventListener("click", loadSupabaseData);
}

function renderSyncPanel(options = {}) {
  const { showDebug = true } = options;
  const user = syncState.user;
  const job = syncState.lastJob;
  const isConfigured = syncState.configured;
  const counts = jobCounts();
  const upload = syncState.lastUploadResult;
  const aiJob = syncState.lastAiJobResult;
  const lastError = syncState.lastError;
  const storage = syncState.lastStorageCheck;
  const userEmail = user?.email || "メール未取得";
  const statusLabel = user ? "同期: 有効" : isConfigured ? "同期: ログイン待ち" : "同期: 未設定";
  return `
    <section class="panel sync-panel">
      <div class="panel-header compact">
        <div>
          <p class="section-kicker">Supabaseログイン</p>
          <h2>${statusLabel}</h2>
        </div>
        ${user ? `<button id="supabase-signout" class="ghost-button" type="button">ログアウト</button>` : ""}
      </div>
      <p class="note-text">${escapeHtml(syncState.message || "")}</p>
      ${user ? `
        <div class="sync-user-box">
          <strong>ログイン中: ${escapeHtml(userEmail)}</strong>
          <span>user_id: ${escapeHtml(user.id)}</span>
        </div>
      ` : `
        <p class="note-text">Web同期とAI処理依頼を使うには、Supabase Authでメールログインしてください。</p>
        <div class="sync-login-row">
          <input id="supabase-email" type="email" placeholder="メールアドレス" />
          <button id="supabase-login" class="primary-action" type="button">ログインメール送信</button>
        </div>
        ${isConfigured ? `<p class="note-text">メールに届いたリンクを開くと、このStudy Managerへ戻ってログインできます。</p>` : ""}
      `}
      ${lastError ? `
        <div class="error-panel">
          <strong>${escapeHtml(lastError.context)}</strong>
          <span>${escapeHtml(lastError.message)}</span>
          ${lastError.code ? `<small>code/status: ${escapeHtml(lastError.code)}</small>` : ""}
          ${lastError.hint ? `<small>hint: ${escapeHtml(lastError.hint)}</small>` : ""}
        </div>
      ` : ""}
      ${showDebug ? `<div class="debug-grid">
        <div><span>ログイン状態</span><strong>${user ? "ログイン済み" : isConfigured ? "未ログイン" : "Supabase未設定"}</strong></div>
        <div><span>user.id</span><strong>${user?.id || "-"}</strong></div>
        <div><span>Storage bucket名</span><strong>${SUPABASE_BUCKET}</strong></div>
        <div><span>Storage bucket確認</span><strong>${storage ? `${storage.ok ? "OK" : "NG"} / ${storage.message}` : "未確認"}</strong></div>
        <div><span>最後のアップロード結果</span><strong>${upload ? `${upload.ok ? "OK" : "NG"} / ${upload.file_path || "-"} / ${upload.message}` : "なし"}</strong></div>
        <div><span>最後のai_jobs作成結果</span><strong>${aiJob ? `${aiJob.ok ? "OK" : "NG"} / ${aiJob.status || "-"} / ${aiJob.id || "-"} / ${aiJob.message}` : "なし"}</strong></div>
        <div><span>最後のエラー内容</span><strong>${lastError ? `${lastError.context}: ${lastError.message}` : "-"}</strong></div>
        <div><span>pending件数</span><strong>${counts.pending}</strong></div>
        <div><span>processing件数</span><strong>${counts.processing}</strong></div>
        <div><span>completed件数</span><strong>${counts.completed}</strong></div>
        <div><span>failed件数</span><strong>${counts.failed}</strong></div>
        <div><span>last job</span><strong>${job?.id || "なし"}</strong></div>
        <div><span>worker time</span><strong>${job?.worker_processed_at || syncState.lastWorkerAt || "-"}</strong></div>
        <div><span>job error</span><strong>${job?.error_message || "-"}</strong></div>
      </div>` : ""}
      ${job?.ocr_result?.text || job?.ocr_result?.layout_text ? `
        <details class="job-detail-block">
          <summary>ocr_text preview</summary>
          <pre>${escapeHtml((job.ocr_result.layout_text || job.ocr_result.text || "").slice(0, 800))}</pre>
        </details>
      ` : ""}
    </section>
  `;
}

function bindSyncPanel(root) {
  root.querySelector("#supabase-login")?.addEventListener("click", () => {
    const email = root.querySelector("#supabase-email")?.value.trim();
    if (!email) {
      showToast("メールアドレスを入力してください");
      return;
    }
    signInWithEmail(email);
  });
  root.querySelector("#supabase-signout")?.addEventListener("click", signOutSupabase);
}

function renderSettings() {
  const view = document.getElementById("settings-view");
  view.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Settings</p><h1>設定</h1></div></div>
    ${renderSyncPanel({ showDebug: false })}
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
          <label><span>接続方式</span><input value="Supabase DB / Storage + local worker" /></label>
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
        <h2>Supabase同期</h2>
        <p class="note-text">正本データはSupabaseに保存します。localStorageはオフライン時の一時キャッシュとしてだけ使います。</p>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="section-kicker">保存</p>
            <h2>設定を保存</h2>
          </div>
          <button id="save-settings" class="primary-action" type="button">保存</button>
        </div>
        <p class="note-text">保存した設定はSupabaseへ同期され、同じアカウントのPC・スマホ・iPadに反映されます。worker側の.envにも同じモデル名を指定してください。</p>
      </section>
    </div>
  `;
  bindSyncPanel(view);
  view.querySelector("#save-settings").addEventListener("click", () => {
    state.settings = {
      ...state.settings,
      ollamaModel: view.querySelector("#setting-model").value.trim() || "elyza:jp8b",
      ocrLanguage: view.querySelector("#setting-ocr-language").value.trim() || "japan",
      defaultQuestionCount: Number(view.querySelector("#setting-question-count").value) || 10,
    };
    saveState(STORAGE.settings, state.settings);
    showToast(isSupabaseReady() ? "設定を保存しました。Supabaseへ同期します" : "設定をローカル保存しました。同期にはSupabaseログインが必要です");
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
  document.getElementById("add-class-ai-job").addEventListener("click", async () => {
    if (!state.activeClass) return;
    try {
      const relatedClass = {
        date: state.activeClass.date,
        weekday: state.activeClass.weekday,
        period: state.activeClass.period,
        subject: state.activeClass.subject,
        teacher: state.activeClass.teacher,
      };
      const job = await createSupabaseAiJob({
        jobType: "generate_questions",
        subject: state.activeClass.subject,
        inputText: `${state.activeClass.date} ${state.activeClass.period}限 ${state.activeClass.subject}`,
        metadata: {
          related_subject: state.activeClass.subject,
          related_date: state.activeClass.date,
          related_period: state.activeClass.period,
          related_class: relatedClass,
          material_type: "class_material",
        },
      });
      state.jobs.unshift(job);
      cacheAllState();
      closeSheet();
      renderAll();
      showToast("AI処理依頼をSupabaseに保存しました");
    } catch (error) {
      showToast(`AI処理依頼を作成できませんでした: ${error.message}`);
    }
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
      const entry = state.timetable.find((item) => String(item.weekday) === weekday && String(item.period) === period);
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
  const lastError = syncState.lastError;
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
    ${lastError ? `<div class="error-panel compact-error"><strong>${escapeHtml(lastError.context)}</strong><span>${escapeHtml(lastError.message)}</span></div>` : ""}
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
    showToast("Supabaseへアップロードしています");
    const job = await buildClassUploadJob(file, kind, state.activeClass);
    state.jobs.unshift(job);
    cacheAllState();
    openClassSheet(state.activeClass);
    renderImportCenter();
    showToast("pending jobをSupabaseに作成しました。PC側workerが処理します");
  } catch (error) {
    recordSupabaseError("授業カードアップロード失敗", error);
    openClassSheet(state.activeClass);
    renderImportCenter();
    showToast(`AI jobを作成できませんでした: ${error.message}`);
  } finally {
    input.value = "";
  }
}

async function buildClassUploadJob(file, kind, classInfo) {
  const relatedClass = {
      date: classInfo.date,
      weekday: classInfo.weekday,
      period: classInfo.period,
      subject: classInfo.subject,
      teacher: classInfo.teacher,
    };
  return createSupabaseAiJob({
    file,
    jobType: kind === "print" ? "analyze_print_image" : kind === "note" ? "analyze_note_image" : "analyze_board_image",
    subject: classInfo.subject,
    inputText: "",
    prompt: "OCR結果をもとに、要約、重要語句、問題、解答、理解度確認データを作成してください。",
    metadata: {
      related_subject: classInfo.subject,
      related_date: classInfo.date,
      related_period: classInfo.period,
      related_class: relatedClass,
      material_type: kind,
      file_name: file.name,
      source: "class_detail_upload",
    },
  });
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
  const previewUrl = job.file_preview_url || "";
  return `
    <div class="class-job-result">
      <strong>${job.uploaded_file?.name || job.job_type}</strong>
      <small>${job.source_type} / ${job.status} / ${job.material_type || "material"}</small>
      ${previewUrl && job.source_type === "image" ? `<img class="uploaded-preview" src="${previewUrl}" alt="${escapeAttr(job.file_name || "アップロード画像")}" />` : ""}
      ${job.source_type === "pdf" ? `<p class="note-text">PDF: ${escapeHtml(job.file_name || job.uploaded_file?.name || "")}</p>` : ""}
      <div class="ai-status-box">
        <strong>AI処理状態</strong>
        <span>${job.status === "pending" ? "AI処理待ち" : job.status}</span>
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
  try {
    showToast("SupabaseにAI処理依頼を保存しています");
    const job = await createSupabaseAiJob({
      file,
      jobType: `import_${kind}`,
      subject: kind === "annual_schedule" ? "年間予定" : kind === "timetable" ? "時間割" : "",
      inputText: "",
      prompt: "OCR結果のレイアウト構造を保ちながら、Study Managerへ反映する候補をJSON形式で整理してください。",
      metadata: {
        import_kind: kind,
        effective_from: effectiveInput?.value || null,
        grade_filter: view.querySelector("#grade-filter")?.value || "grade3",
        related_date: DATA.today,
        file_name: file?.name || null,
        source: "ai_import_center",
      },
    });
    state.jobs.unshift(job);
    cacheAllState();
    renderAll();
    showToast("pending jobをSupabaseに作成しました");
  } catch (error) {
    recordSupabaseError("AI取り込みセンター登録失敗", error);
    renderAll();
    showToast(`AI処理依頼を作成できませんでした: ${error.message}`);
  }
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
  const entry = state.timetable.find((item) => item.weekday === weekday && item.period === period);
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
      ${menu.needs_review ? `<div class="meal review-meal"><strong>確認</strong><span>needs_review</span></div>` : ""}
    </div>
  `;
}

function renderCompactMenu(menu) {
  return `
    <details class="menu-compact">
      <summary>
        <span><strong>朝</strong>${escapeHtml(shortMeal(menu.breakfast))}</span>
        <span><strong>昼</strong>${escapeHtml(shortMeal(menu.lunch))}</span>
        <span><strong>夕</strong>${escapeHtml(shortMeal(menu.dinner))}</span>
      </summary>
      ${renderMenu(menu)}
    </details>
    <p class="menu-kcal-line">${menu.kcal || "kcal未設定"} kcal${menu.event_note ? ` / ${escapeHtml(menu.event_note)}` : ""}${menu.needs_review ? " / needs_review" : ""}</p>
  `;
}

function shortMeal(text) {
  return String(text || "未登録").split("/").slice(0, 2).map((item) => item.trim()).join(" / ");
}

function renderAiStatusCompact(counts) {
  return `
    <div class="ai-count-row">
      <span><strong>${counts.pending}</strong>pending</span>
      <span><strong>${counts.processing}</strong>processing</span>
      <span><strong>${counts.completed}</strong>completed</span>
      <span><strong>${counts.failed}</strong>failed</span>
    </div>
    <button class="ghost-button full" data-route="import" type="button">AI取り込みセンター</button>
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

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventsOnDate(date) {
  const target = parseDate(date);
  return state.events.filter((event) => target >= parseDate(event.start_date) && target <= parseDate(event.end_date));
}

function todosForDate(date) {
  return state.todos.filter((todo) => isTodoActiveOn(todo, date));
}

function timetableForDate(date) {
  const weekday = dayOfWeekMondayBase(date);
  return state.timetable.filter((entry) => entry.weekday === weekday);
}

function menuForDate(date) {
  return state.menus[date] || {
    breakfast: "未登録",
    lunch: "未登録",
    dinner: "未登録",
    kcal: "",
    raw_text: "",
  };
}

function getCountdowns(fromDate) {
  const eventCountdowns = state.events
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
  saveLocalState(key, value);
  persistSupabaseSoon();
}

function saveLocalState(key, value) {
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
