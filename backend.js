/* ==========================================================
  TASKFLOW — client controller
   Talks to a Google Apps Script Web App (acts as backend + DB
   via Google Sheets) and to Firebase Cloud Messaging (push).

   >>> FILL THESE THREE THINGS IN BEFORE DEPLOYING <<<
   ========================================================== */
const CONFIG = {
  // Paste the URL you get after deploying apps-script.gs as a Web App
  API_URL: "https://script.google.com/macros/s/AKfycbxh34Fm-Z2DZYj4TEMcPh2f_-sM-9OgqssZPP3go-u2Yn7ONQYE7R9hHDNclNfcCsDc/exec",

  // Paste your Firebase project config (Project settings → General → Your apps → SDK config)
  FIREBASE: {
    apiKey: "AIzaSyANgaHIpu0gY_GLWFhyIc_z0WY_S59PY3M",
    authDomain: "website01-7e1e2.firebaseapp.com",
    projectId: "website01-7e1e2",
    messagingSenderId: "835136877236",
    appId: "1:835136877236:web:b7a4178f036d7ecc25dde1"
  },
  // Firebase → Project settings → Cloud Messaging → Web configuration → Web Push certificate
  VAPID_KEY: "BBoF5hkKmT-GSSOS3Fuh7EYnf1iSLwVbmZiXvxBmWv7TGWqIAfq2mxdk7_JX6-37n0D1oTe0GDoKpvC6fdn3l9E"
};

/* ==========================================================
   Static department form definitions
   (field 'key' = exact Google Sheet column name — keep in sync
   with apps-script.gs / SETUP_GUIDE.md)
   ========================================================== */
const FORMS = {
  restaurant: {
    sheet: "Sheet1_Restaurant",
    title: "Restaurant / buyer visit",
    fields: [
      { key: "Type", label: "Type", type: "choice", options: ["Restaurant", "Hotel", "Dhaba", "Dark Store", "Retailer"] },
      { key: "Business_Name", label: "Business name", type: "text" },
      { key: "Location", label: "Location (area/locality)", type: "text" },
      { key: "Contact_Number", label: "Contact number", type: "tel" },
      { key: "Requirement_Kg", label: "Daily/weekly requirement (approx kg)", type: "number" },
      { key: "Sourcing_Problems", label: "Sourcing problem(s)", type: "multichoice", options: ["Quality inconsistent", "Delivery late", "Price fluctuation", "Vendor unreliable", "Bulk nahi milta"] },
      { key: "Order_Issues_Count", label: "Orders short/late/bad — last month (number)", type: "number" },
      { key: "Willing_To_Pay_Extra", label: "Pay ₹2–4/kg extra for guaranteed on-time + quality-checked supply?", type: "choice", options: ["Yes", "No", "Depends"] },
      { key: "Trial_Batch_Ready", label: "Ready for a 2-week trial batch?", type: "choice", options: ["Yes", "No"] },
      { key: "Other_Insights", label: "Other insights", type: "textarea" }
    ]
  },
  farmer: {
    sheet: "Sheet2_Farmers",
    title: "Farmer visit",
    fields: [
      { key: "Farmer_Name", label: "Farmer name", type: "text" },
      { key: "Mobile_Number", label: "Mobile number", type: "tel" },
      { key: "Village_Address", label: "Village / address", type: "text" },
      { key: "Selling_Method", label: "Upaj kaise bechte ho abhi?", type: "multichoice", options: ["Khud mandi jaate ho", "Agent use karte ho", "Trader farm pe aata hai"] },
      { key: "Waste_Percent", label: "% upaj waste / distress-sale last season (approx)", type: "number" },
      { key: "Advance_Payment_Needed", label: "Advance payment chahiye hoti hai crop se pehle?", type: "choice", options: ["Yes", "No"] },
      { key: "Willing_To_Switch", label: "Pickup + zero-upfront storage + pay-on-sale mile to switch karoge?", type: "choice", options: ["Yes", "No", "Maybe"] }
    ]
  },
  logisticsA: {
    sheet: "Sheet3_Logistics", form_type: "Cost_Verification",
    title: "Form A — Cost verification",
    fields: [
      { key: "Item", label: "Item", type: "choice", options: ["Warehouse rent (per sq ft)", "Cold storage setup cost", "Transport vehicle (lease/EMI)", "Hub manager salary", "Grading staff salary", "Driver/logistics staff salary"] },
      { key: "Source_Contact", label: "Source (vendor/contact)", type: "text" },
      { key: "Quoted_Amount", label: "Quoted amount", type: "number" },
      { key: "Quote_Date", label: "Date", type: "date" },
      { key: "Status", label: "Status", type: "choice", options: ["Confirmed", "Estimated"] }
    ]
  },
  logisticsB: {
    sheet: "Sheet3_Logistics", form_type: "Compliance_Legal",
    title: "Form B — Compliance & legal",
    fields: [
      { key: "Requirement", label: "Requirement", type: "choice", options: ["Business registration type", "FPO registration", "FSSAI license", "Govt agri-startup scheme"] },
      { key: "Process_Steps", label: "Process / steps", type: "textarea" },
      { key: "Cost", label: "Cost", type: "number" },
      { key: "Timeline", label: "Timeline", type: "text" },
      { key: "Source_Verified_From", label: "Source verified from", type: "text" }
    ]
  },
  logisticsC: {
    sheet: "Sheet3_Logistics", form_type: "Breakeven_Input",
    title: "Form C — Break-even inputs",
    fields: [
      { key: "Input_Type", label: "Input type", type: "choice", options: ["Total Fixed Cost/Month", "Avg Contribution Margin per kg", "Spoilage %"] },
      { key: "Value", label: "Value", type: "number" },
      { key: "Source", label: "Source", type: "text" }
    ]
  }
};

const DEPT_FORM = {
  amit: ["restaurant"],
  sanjay: ["logisticsA", "logisticsB", "logisticsC"],
  narendra: ["farmer"],
  // rajsingh uses the checklist UI, not a FORMS entry
};

const MEMBER_ROLE_LABELS = {
  rajsingh: "Founder & CEO / Head of Product, Tech & Data",
  amit: "Co-founder & Head of Demand & Business Development",
  narendra: "Co-founder & Head of Supply & Field Operations",
  sanjay: "Co-founder & Head of Finance & Logistics Operations"
};

const WEEK_POINTS = { 1: 10, 2: 10, 3: 5 };

/* ==========================================================
   Session
   ========================================================== */
const SESSION_KEY = "fo_session_v1";
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

let STATE = {
  user: null,       // {id, name, role, department, phone}
  dashboard: null,  // {points, weeks:[{week,points,target}], tasks:[...]}
  activePane: "dashboard",
  logisticsTab: "logisticsA",
  adminQuestionEditor: { mode: "create", taskId: null },
  chatMessages: [],
  chatTimer: null
};

/* ==========================================================
   API helper
   ========================================================== */
async function api(action, payload) {
  if (CONFIG.API_URL.includes("PASTE_")) {
    toast("Backend URL not set yet — see SETUP_GUIDE.md");
    throw new Error("API_URL not configured");
  }
  const res = await fetch(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight on Apps Script
    body: JSON.stringify({ action, payload })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Request failed");
  return data.result;
}

/* ==========================================================
   Toast
   ========================================================== */
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ==========================================================
   Boot
   ========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  wireLoginForm();
  const session = loadSession();
  if (session && session.user) {
    STATE.user = session.user;
    enterApp();
  }
});

function wireLoginForm() {
  document.querySelectorAll(".login-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".login-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const isAdmin = tab.dataset.tab === "admin";
      document.getElementById("form-login-member").classList.toggle("hidden", isAdmin);
      document.getElementById("form-login-admin").classList.toggle("hidden", !isAdmin);
      hideLoginError();
    });
  });

  document.getElementById("form-login-member").addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = document.getElementById("input-phone").value.trim();
    if (!phone) return;
    await doLogin({ type: "member", phone });
  });

  document.getElementById("form-login-admin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("input-code").value.trim();
    if (!code) return;
    await doLogin({ type: "admin", code });
  });
}

async function doLogin(payload) {
  hideLoginError();
  try {
    const result = await api("login", payload);
    STATE.user = result.user;
    saveSession({ user: result.user });
    enterApp();
  } catch (err) {
    showLoginError(err.message || "Login failed. Check the number/code and try again.");
  }
}

function showLoginError(msg) {
  const el = document.getElementById("login-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideLoginError() { document.getElementById("login-error").classList.add("hidden"); }

document.getElementById("btn-logout").addEventListener("click", () => {
  clearSession();
  stopChatPolling();
  STATE = { ...STATE, user: null, dashboard: null };
  document.getElementById("view-main").classList.add("hidden");
  document.getElementById("view-login").classList.remove("hidden");
});

/* ==========================================================
   Enter app / routing
   ========================================================== */
async function enterApp() {
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("view-main").classList.remove("hidden");

  document.getElementById("tb-name").textContent = STATE.user.name;
  document.getElementById("tb-role").textContent = getMemberRoleLabel(STATE.user);

  buildBottomNav();
  wireStaticForms();
  await goTo(STATE.user.role === "admin" ? "admin-team" : "dashboard");
  setupPushNotifications();
  startChatPolling();
}

function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function getMemberRoleLabel(member) {
  if (!member) return "";
  if (member.role === "admin") return "Admin";
  const key = String(member.id || member.department || "").toLowerCase();
  return MEMBER_ROLE_LABELS[key] || titleCase(member.department || "");
}

function buildBottomNav() {
  const nav = document.getElementById("bottomnav");
  nav.innerHTML = "";
  const items = STATE.user.role === "admin"
    ? [
        { pane: "admin-team", ico: "👥", label: "Team" },
        { pane: "admin-assign", ico: "➕", label: "Assign" },
        { pane: "chat", ico: "💬", label: "Chat" },
        { pane: "profile", ico: "👤", label: "Profile" }
      ]
    : [
        { pane: "dashboard", ico: "🏠", label: "Home" },
        { pane: "form", ico: "📋", label: "Tasks" },
        { pane: "chat", ico: "💬", label: "Chat" },
        { pane: "profile", ico: "👤", label: "Profile" }
      ];
  items.forEach((it, i) => {
    const btn = document.createElement("button");
    btn.className = "nav-btn" + (i === 0 ? " active" : "");
    btn.dataset.pane = it.pane;
    btn.innerHTML = `<span class="nav-ico">${it.ico}</span><span>${it.label}</span>` +
      (it.pane === "chat" ? `<span class="nav-badge hidden" id="chat-badge"></span>` : "");
    btn.addEventListener("click", () => goTo(it.pane));
    nav.appendChild(btn);
  });
  document.querySelectorAll(".back-link").forEach(b =>
    b.addEventListener("click", () => goTo(b.dataset.back))
  );
}

const PANE_IDS = ["dashboard", "form", "chat", "profile", "admin-team", "admin-detail", "admin-assign", "question-task", "repeat-form"];

async function goTo(pane, opts) {
  STATE.activePane = pane;
  PANE_IDS.forEach(p => document.getElementById(`pane-${p}`).classList.toggle("hidden", p !== pane));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.pane === pane));

  if (pane === "dashboard") await renderDashboard();
  if (pane === "form") await renderFormPane();
  if (pane === "chat") await renderChat(true);
  if (pane === "profile") await renderProfile();
  if (pane === "admin-team") await renderAdminTeam();
  if (pane === "admin-detail") await renderAdminDetail(opts && opts.memberId);
  if (pane === "admin-assign") await renderAdminAssign(opts);
  if (pane === "question-task") await renderQuestionTaskPane(opts && opts.taskId);
  if (pane === "repeat-form") await renderRepeatFormPane(opts && opts.taskId);

  document.getElementById("content").scrollTo({ top: 0 });
}

/* ==========================================================
   DASHBOARD
   ========================================================== */
async function renderDashboard() {
  try {
    STATE.dashboard = await api("getDashboard", { memberId: STATE.user.id });
  } catch (e) { toast(e.message); return; }

  const d = STATE.dashboard;
  const pct = Math.min(100, Math.round((d.totalPoints / 25) * 100));
  document.getElementById("points-ring").style.setProperty("--pct", pct);
  document.getElementById("points-total").textContent = d.totalPoints;

  const weekBars = document.getElementById("week-bars");
  weekBars.innerHTML = "";
  [1, 2, 3].forEach(w => {
    const max = WEEK_POINTS[w];
    const earned = (d.weeks && d.weeks[w]) || 0;
    const row = document.createElement("div");
    row.className = "week-bar-row";
    row.innerHTML = `
      <span class="label">Week ${w}</span>
      <span class="week-bar-track"><span class="week-bar-fill" style="width:${Math.min(100, (earned / max) * 100)}%"></span></span>
      <span class="val">${earned}/${max}</span>`;
    weekBars.appendChild(row);
  });

    const list = document.getElementById("task-list");
  list.innerHTML = "";
  (d.tasks || []).forEach(t => {
    const card = document.createElement("div");
    card.className = "task-card" + (t.completed ? " is-done" : "");
    card.innerHTML = `
      <div class="t-body">
        <div class="t-desc">${escapeHtml(t.description)}</div>
        <div class="t-meta">Week ${t.week} · ${t.points} pts${t.progress != null ? ` · ${t.progress}/${t.target}` : ""}</div>
      </div>
      <span class="pill ${t.completed ? "done" : ""}">${t.completed ? "Done" : "Pending"}</span>`;
    if (t.type === "QUESTION") {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => goTo("question-task", { taskId: t.id }));
    }
    if (t.type === "COUNT" && t.formType === "DYNAMIC_REPEAT") {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => goTo("repeat-form", { taskId: t.id }));
    }
    list.appendChild(card);
  });
}

/* ==========================================================
   FORM PANE — routes by department
   ========================================================== */
async function renderFormPane() {
  const host = document.getElementById("form-host");
  host.innerHTML = "";

  if (STATE.user.department === "rajsingh") {
    await renderChecklistForm(host);
    return;
  }
  if (STATE.user.department === "sanjay") {
    renderLogisticsTabs(host);
    return;
  }
  const key = (DEPT_FORM[STATE.user.department] || [])[0];
  if (!key) { host.innerHTML = `<p class="hint">No form configured for this role yet.</p>`; return; }
  renderFieldForm(host, key);
}

function renderLogisticsTabs(host) {
  const tabs = document.createElement("div");
  tabs.className = "subform-tabs";
  ["logisticsA", "logisticsB", "logisticsC"].forEach(k => {
    const b = document.createElement("button");
    b.textContent = FORMS[k].title;
    b.className = k === STATE.logisticsTab ? "active" : "";
    b.addEventListener("click", () => { STATE.logisticsTab = k; renderFormPane(); });
    tabs.appendChild(b);
  });
  host.appendChild(tabs);
  const body = document.createElement("div");
  host.appendChild(body);
  renderFieldForm(body, STATE.logisticsTab);
}

function renderFieldForm(host, formKey) {
  const def = FORMS[formKey];
  const wrap = document.createElement("form");
  wrap.className = "stack-form";
  wrap.innerHTML = `<h3 class="form-section-title">${def.title}</h3>`;

  const fieldState = {};
  def.fields.forEach(f => {
    const label = document.createElement("label");
    label.textContent = f.label;
    wrap.appendChild(label);

    if (f.type === "choice" || f.type === "multichoice") {
      fieldState[f.key] = f.type === "multichoice" ? [] : "";
      const group = document.createElement("div");
      group.className = "choice-group";
      f.options.forEach(opt => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "choice-chip";
        chip.textContent = opt;
        chip.addEventListener("click", () => {
          if (f.type === "multichoice") {
            const idx = fieldState[f.key].indexOf(opt);
            if (idx > -1) { fieldState[f.key].splice(idx, 1); chip.classList.remove("selected"); }
            else { fieldState[f.key].push(opt); chip.classList.add("selected"); }
          } else {
            fieldState[f.key] = opt;
            group.querySelectorAll(".choice-chip").forEach(c => c.classList.remove("selected"));
            chip.classList.add("selected");
          }
        });
        group.appendChild(chip);
      });
      wrap.appendChild(group);
    } else {
      const input = document.createElement(f.type === "textarea" ? "textarea" : "input");
      if (f.type !== "textarea") input.type = f.type === "tel" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
      if (f.type === "textarea") input.rows = 3;
      input.addEventListener("input", () => { fieldState[f.key] = input.value; });
      wrap.appendChild(input);
    }
  });

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn btn-primary btn-block";
  submitBtn.style.marginTop = "20px";
  submitBtn.textContent = "Submit entry";
  wrap.appendChild(submitBtn);

  const msg = document.createElement("p");
  msg.className = "hint hidden";
  wrap.appendChild(msg);

  wrap.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    try {
      const result = await api("submitForm", {
        memberId: STATE.user.id,
        sheet: def.sheet,
        formType: def.form_type || null,
        data: fieldState
      });
      msg.className = "hint";
      msg.textContent = result.pointsAwarded
        ? `Saved. Week ${result.week} task complete — +${result.pointsAwarded} pts!`
        : `Saved. (${result.progress}/${result.target} this week)`;
      toast("Entry submitted");
      wrap.reset();
      wrap.querySelectorAll(".choice-chip.selected").forEach(c => c.classList.remove("selected"));
      Object.keys(fieldState).forEach(k => { fieldState[k] = Array.isArray(fieldState[k]) ? [] : ""; });
    } catch (err) {
      msg.className = "hint error";
      msg.textContent = err.message || "Could not submit — check your connection.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit entry";
    }
  });

  host.appendChild(wrap);
}

async function renderChecklistForm(host) {
  host.innerHTML = `<h3 class="form-section-title">This week's tasks</h3><p class="form-progress">Mark each task as you complete it — points add automatically.</p>`;
  let items;
  try {
    items = await api("getRajTasks", { memberId: STATE.user.id });
  } catch (e) { toast(e.message); return; }

  items.forEach(t => {
    const row = document.createElement("div");
    row.className = "checklist-item";
    row.innerHTML = `
      <div class="cl-desc"><strong>W${t.week}</strong> · ${escapeHtml(t.description)} <span class="pill">${t.points} pts</span></div>
      <button class="toggle ${t.completed ? "on" : ""}" aria-label="Toggle complete"></button>`;
    row.querySelector(".toggle").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const next = !btn.classList.contains("on");
      btn.classList.toggle("on", next);
      try {
        await api("toggleRajTask", { memberId: STATE.user.id, taskId: t.id, completed: next });
        toast(next ? `+${t.points} pts` : "Marked incomplete");
      } catch (err) {
        btn.classList.toggle("on", !next);
        toast(err.message);
      }
    });
    host.appendChild(row);
  });
}

/* ==========================================================
   CHAT
   ========================================================== */
function startChatPolling() {
  stopChatPolling();
  STATE.chatTimer = setInterval(() => renderChat(false), 6000);
}
function stopChatPolling() { if (STATE.chatTimer) clearInterval(STATE.chatTimer); }

async function renderChat(scrollToBottom) {
  let msgs;
  try { msgs = await api("getChat", {}); } catch (e) { return; }
  const changed = msgs.length !== STATE.chatMessages.length;
  STATE.chatMessages = msgs;

  if (STATE.activePane !== "chat") {
    document.getElementById("chat-badge") && changed &&
      document.getElementById("chat-badge").classList.remove("hidden");
    return;
  }
  const log = document.getElementById("chat-log");
  log.innerHTML = "";
  msgs.forEach(m => {
    const b = document.createElement("div");
    b.className = "chat-bubble" + (m.senderId === STATE.user.id ? " mine" : "");
    b.innerHTML = `<span class="c-sender">${escapeHtml(m.senderName)}</span>${escapeHtml(m.text)}<span class="c-time">${m.time}</span>`;
    log.appendChild(b);
  });
  if (scrollToBottom) log.scrollTop = log.scrollHeight;
}

document.getElementById("form-chat").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await api("sendChat", { senderId: STATE.user.id, senderName: STATE.user.name, text });
    await renderChat(true);
  } catch (err) { toast(err.message); }
});

/* ==========================================================
   PROFILE
   ========================================================== */
async function renderProfile() {
  const host = document.getElementById("profile-host");
  const u = STATE.user;
  const d = STATE.dashboard || await api("getDashboard", { memberId: u.id }).catch(() => null);
  host.innerHTML = `
    <div class="profile-row"><span class="k">Name</span><span class="v">${escapeHtml(u.name)}</span></div>
    <div class="profile-row"><span class="k">Role</span><span class="v">${escapeHtml(getMemberRoleLabel(u))}</span></div>
    ${u.phone ? `<div class="profile-row"><span class="k">Phone</span><span class="v">${escapeHtml(u.phone)}</span></div>` : ""}
    ${d ? `<div class="profile-row"><span class="k">Total points</span><span class="v">${d.totalPoints} / 25</span></div>` : ""}
  `;
}

/* ==========================================================
   ADMIN — team overview / detail / assign
   ========================================================== */
async function renderAdminTeam() {
  const host = document.getElementById("admin-team-list");
  host.innerHTML = `<p class="hint">Loading…</p>`;
  let members;
  try { members = await api("adminGetTeam", {}); } catch (e) { toast(e.message); return; }
  host.innerHTML = "";
  members.forEach(m => {
    const card = document.createElement("div");
    card.className = "admin-member-card";
    card.innerHTML = `
      <div class="avatar">${m.name.split(" ").map(w => w[0]).join("").slice(0,2)}</div>
      <div class="am-body">
        <div class="am-name">${escapeHtml(m.name)}</div>
        <div class="am-dept">${escapeHtml(getMemberRoleLabel(m))}</div>
      </div>
      <div class="am-pts">${m.totalPoints}/25</div>`;
    card.addEventListener("click", () => goTo("admin-detail", { memberId: m.id }));
    host.appendChild(card);
  });
  const link = document.createElement("a");
  link.className = "data-link";
  link.href = "#";
  link.textContent = "Open master Google Sheet ↗";
  link.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const { url } = await api("adminGetSheetUrl", {});
      window.open(url, "_blank");
    } catch (err) { toast(err.message); }
  });
  host.appendChild(link);
}

async function renderAdminDetail(memberId) {
  const host = document.getElementById("admin-detail-host");
  host.innerHTML = `<p class="hint">Loading…</p>`;
  let detail;
  try { detail = await api("adminGetMemberDetail", { memberId }); } catch (e) { toast(e.message); return; }
  host.innerHTML = `
    <h2 class="pane-title" style="margin-top:0">${escapeHtml(detail.name)}</h2>
    <p class="hint">${escapeHtml(getMemberRoleLabel(detail))} · ${detail.totalPoints}/25 pts</p>
    <div class="task-list" style="margin-top:14px;"></div>`;
  const list = host.querySelector(".task-list");

  if (!detail.tasks || !detail.tasks.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No tasks assigned yet.";
    list.appendChild(empty);
    return;
  }

  (detail.tasks || []).forEach(t => {
    const card = document.createElement("div");
    card.className = "task-card" + (t.completed ? " is-done" : "");
    const canEdit = t.type === "QUESTION";
    card.innerHTML = `
      <div class="t-body">
        <div class="t-desc">${escapeHtml(t.description)}</div>
        <div class="t-meta">Week ${t.week} · ${t.points} pts${t.progress != null ? ` · ${t.progress}/${t.target}` : ""}</div>
      </div>
      <div class="task-card-actions">
        <span class="pill ${t.completed ? "done" : ""}">${t.completed ? "Done" : "Pending"}</span>
        ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm admin-edit-task">Edit</button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm admin-delete-task" aria-label="Delete task">Delete</button>
      </div>`;

    const editBtn = card.querySelector(".admin-edit-task");
    if (editBtn) {
      editBtn.addEventListener("click", async () => {
        setAdminQuestionEditorMode("edit", t.id);
        await goTo("admin-assign", {
          editTask: {
            taskId: t.id,
            memberId,
            week: t.week,
            points: t.points,
            title: t.description
          }
        });
      });
    }

    const delBtn = card.querySelector(".admin-delete-task");
    delBtn.addEventListener("click", async () => {
      const ok = window.confirm("Delete this task permanently? This cannot be undone.");
      if (!ok) return;
      delBtn.disabled = true;
      delBtn.textContent = "Deleting...";
      try {
        await api("adminDeleteTask", { taskId: t.id });
        toast("Task deleted");
        await renderAdminDetail(memberId);
      } catch (err) {
        delBtn.disabled = false;
        delBtn.textContent = "Delete";
        toast(err.message || "Could not delete task.");
      }
    });

    list.appendChild(card);
  });
}

async function renderAdminAssign(opts) {
  const select = document.getElementById("assign-member");
  if (!select.options.length) {
    try {
      const members = await api("adminGetTeam", {});
      select.innerHTML = members.map(m => `<option value="${m.id}">${escapeHtml(m.name)} — ${escapeHtml(getMemberRoleLabel(m))}</option>`).join("");
    } catch (e) { toast(e.message); }
  }

  const editTask = (opts && opts.editTask) || (STATE.adminQuestionEditor.mode === "edit" && STATE.adminQuestionEditor.taskId ? { taskId: STATE.adminQuestionEditor.taskId } : null);
  if (editTask) {
    setAdminQuestionEditorMode("edit", editTask.taskId);
    await loadAdminQuestionEditor(editTask);
    return;
  }

  setAdminQuestionEditorMode("create", null);
  select.disabled = false;
  document.querySelectorAll("#assign-type-tabs button").forEach(b => b.disabled = false);
  document.getElementById("form-assign-task").reset();
  document.getElementById("question-list").innerHTML = "";
  document.getElementById("question-builder").classList.add("hidden");
  document.getElementById("assign-desc-label").textContent = "Task detail";
  document.getElementById("assign-desc").placeholder = "e.g. Perform analysis on farmer dataset";
  document.getElementById("assign-points").value = "2";
  document.getElementById("form-assign-task").querySelector("button[type='submit']").textContent = "Assign task";
}

function setAdminQuestionEditorMode(mode, taskId = null) {
  STATE.adminQuestionEditor = { mode, taskId };
}

function renumberQuestionRows(questionList) {
  Array.from(questionList.querySelectorAll(".question-row")).forEach((row, index) => {
    row.dataset.qid = String(index + 1);
    const order = row.querySelector(".q-order");
    if (order) order.textContent = `Q${index + 1}`;
  });
}

function appendQuestionRow(questionList, text = "") {
  const row = document.createElement("div");
  row.className = "question-row";
  row.innerHTML = `
    <div class="question-row-head">
      <span class="q-order"></span>
      <button type="button" class="icon-btn q-remove" title="Remove question" aria-label="Remove question">✕</button>
    </div>
    <input type="text" class="q-text" placeholder="Question text" value="${escapeHtml(text)}">
    <textarea class="q-answer-preview" rows="2" placeholder="Member answer box (auto-created)" disabled></textarea>`;
  row.querySelector(".q-remove").addEventListener("click", () => {
    row.remove();
    if (!questionList.querySelectorAll(".question-row").length) appendQuestionRow(questionList, "");
    renumberQuestionRows(questionList);
  });
  questionList.appendChild(row);
  renumberQuestionRows(questionList);
  return row;
}

function renderQuestionRows(questionList, questions) {
  questionList.innerHTML = "";
  const items = Array.isArray(questions) ? questions : [];
  if (!items.length) {
    appendQuestionRow(questionList, "");
    return;
  }
  items.forEach(q => appendQuestionRow(questionList, q));
}

async function loadAdminQuestionEditor(editTask) {
  const assignForm = document.getElementById("form-assign-task");
  const msg = document.getElementById("assign-msg");
  const title = document.getElementById("assign-desc");
  const label = document.getElementById("assign-desc-label");
  const questionBuilder = document.getElementById("question-builder");
  const questionList = document.getElementById("question-list");
  const memberSelect = document.getElementById("assign-member");
  const weekSelect = document.getElementById("assign-week");
  const pointsInput = document.getElementById("assign-points");
  const aimInput = document.getElementById("assign-aim");
  const submitBtn = assignForm.querySelector("button[type='submit']");
  const addBtn = document.getElementById("btn-add-question");

  try {
    const detail = await api("getQuestionTaskDetail", { taskId: editTask.taskId, memberId: editTask.memberId });
    setAssignModeForQuestionEditor();
    memberSelect.value = editTask.memberId || memberSelect.value;
    memberSelect.disabled = true;
    weekSelect.value = String(editTask.week || weekSelect.value);
    pointsInput.value = String(editTask.points || pointsInput.value);
    title.value = editTask.title || detail.title || "";
    aimInput.value = detail.aim || "";
    label.textContent = "Task title";
    questionBuilder.classList.remove("hidden");
    addBtn.textContent = "+ Add Question";
    renderQuestionRows(questionList, detail.questions || []);
    msg.className = "hint";
    msg.textContent = "Editing existing question task.";
    msg.classList.remove("hidden");
    submitBtn.textContent = "Save changes";
  } catch (err) {
    memberSelect.disabled = false;
    document.querySelectorAll("#assign-type-tabs button").forEach(b => b.disabled = false);
    toast(err.message || "Could not load task for editing.");
    setAdminQuestionEditorMode("create", null);
  }
}

function setAssignModeForQuestionEditor() {
  const questionBuilder = document.getElementById("question-builder");
  const descLabel = document.getElementById("assign-desc-label");
  const descInput = document.getElementById("assign-desc");
  document.querySelectorAll("#assign-type-tabs button").forEach(b => b.classList.toggle("active", b.dataset.type === "question"));
  questionBuilder.classList.remove("hidden");
  descLabel.textContent = "Task title";
  descInput.placeholder = "e.g. Restaurant follow-up questions";
}

function wireStaticForms() {
  const assignForm = document.getElementById("form-assign-task");
  if (!assignForm || assignForm.dataset.bound === "1") return;
  assignForm.dataset.bound = "1";

  const aimInput = document.getElementById("assign-aim");
  const memberSelect = document.getElementById("assign-member");
  const weekSelect = document.getElementById("assign-week");
  const descLabel = document.getElementById("assign-desc-label");
  const descInput = document.getElementById("assign-desc");
  const pointsInput = document.getElementById("assign-points");
  const msg = document.getElementById("assign-msg");
  const questionBuilder = document.getElementById("question-builder");
  const questionList = document.getElementById("question-list");
  const addQuestionBtn = document.getElementById("btn-add-question");

  let assignType = "checklist";
  let qCounter = 0;

    function setAssignMode(nextType) {
    assignType = nextType;
    document.querySelectorAll("#assign-type-tabs button").forEach(b => b.classList.toggle("active", b.dataset.type === nextType));
    const usesQuestions = nextType === "question" || nextType === "repeat";
    questionBuilder.classList.toggle("hidden", !usesQuestions);
    document.getElementById("repeat-count-field").classList.toggle("hidden", nextType !== "repeat");
    descLabel.textContent = usesQuestions ? "Task title" : "Task detail";
    descInput.placeholder = nextType === "repeat"
      ? "e.g. Collect 10 farmers' data"
      : nextType === "question"
      ? "e.g. Restaurant follow-up questions"
      : "e.g. Perform analysis on farmer dataset";
    if (usesQuestions && !questionList.children.length) {
      addQuestionRow("");
    }
  }

  document.querySelectorAll("#assign-type-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      setAssignMode(btn.dataset.type);
    });
  });

  function addQuestionRow(text) {
    qCounter++;
    const row = document.createElement("div");
    row.className = "question-row";
    row.dataset.qid = qCounter;
    row.innerHTML = `
      <div class="question-row-head">
        <span class="q-order">Q${qCounter}</span>
        <button type="button" class="icon-btn q-remove" title="Remove question" aria-label="Remove question">✕</button>
      </div>
      <input type="text" class="q-text" placeholder="Question text" value="${escapeHtml(text || "")}">
      <textarea class="q-answer-preview" rows="2" placeholder="Member answer box (auto-created)" disabled></textarea>`;
    row.querySelector(".q-remove").addEventListener("click", () => row.remove());
    questionList.appendChild(row);
    return row;
  }

  addQuestionBtn.addEventListener("click", () => {
    const row = addQuestionRow("");
    const input = row.querySelector(".q-text");
    if (input) input.focus();
  });

  assignForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "hint hidden";

    const memberId = memberSelect.value;
    const week = Number(weekSelect.value);
    const points = Number(pointsInput.value);
    const aim = aimInput.value.trim();
    const text = descInput.value.trim();
    const submitBtn = assignForm.querySelector("button[type='submit']");

    if (!memberId) {
      msg.className = "hint error";
      msg.textContent = "Please select a member.";
      msg.classList.remove("hidden");
      return;
    }
    if (!text) {
      msg.className = "hint error";
      msg.textContent = assignType === "question" ? "Please enter a task title." : "Please enter task detail.";
      msg.classList.remove("hidden");
      return;
    }
    if (!Number.isFinite(points) || points < 1 || points > 25) {
      msg.className = "hint error";
      msg.textContent = "Points must be between 1 and 25.";
      msg.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Assigning...";

        try {
        const isEditingQuestionTask = STATE.adminQuestionEditor.mode === "edit" && !!STATE.adminQuestionEditor.taskId;
        if (assignType === "repeat") {
        const questions = Array.from(questionList.querySelectorAll(".q-text"))
          .map(i => i.value.trim())
          .filter(Boolean);
        if (!questions.length) throw new Error("Add at least one question.");
        const count = Number(document.getElementById("assign-count").value);
        if (!count || count < 1) throw new Error("Entry count must be at least 1.");
        const title = aim ? `Aim: ${aim} | Task: ${text}` : text;
        await api("adminAssignRepeatForm", { memberId, week, title, points, count, questions });
        questionList.innerHTML = "";
        addQuestionRow("");
      } else if (assignType === "question" || isEditingQuestionTask) {
        const questions = Array.from(questionList.querySelectorAll(".q-text"))
          .map(i => i.value.trim())
          .filter(Boolean);
        if (!questions.length) throw new Error("Add at least one question.");
        const title = aim ? `Aim: ${aim} | Task: ${text}` : text;
          if (isEditingQuestionTask) {
            await api("adminAssignQuestionTask", { taskId: STATE.adminQuestionEditor.taskId, memberId, week, title, points, questions });
          } else {
            await api("adminAssignQuestionTask", { memberId, week, title, points, questions });
          }
        questionList.innerHTML = "";
        addQuestionRow("");
      } else {
        await api("adminAssignTask", { memberId, week, aim, description: text, points });
      }
        questionList.innerHTML = "";
        addQuestionRow("");
      } else {
        await api("adminAssignTask", { memberId, week, aim, description: text, points });
      }
      msg.className = "hint";
        msg.textContent = isEditingQuestionTask ? "Task updated." : "Task assigned.";
      assignForm.reset();
      pointsInput.value = "2";
        setAdminQuestionEditorMode("create", null);
        setAssignMode(isEditingQuestionTask ? "question" : assignType);
        toast(isEditingQuestionTask ? "Task updated" : "Task assigned");
    } catch (err) {
      msg.className = "hint error";
      if (assignType === "question" && /Unknown action:\s*adminAssignQuestionTask/i.test(String(err.message || ""))) {
        msg.textContent = "Backend is outdated for Question tasks. Redeploy Apps Script as a new web app version and update API_URL.";
      } else {
        msg.textContent = err.message;
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Assign task";
    }
    msg.classList.remove("hidden");
  });

  setAssignMode(assignType);
}

/* ==========================================================
   QUESTION TASK — member view
   ========================================================== */
async function renderQuestionTaskPane(taskId) {
  const host = document.getElementById("question-task-host");
  host.innerHTML = `<p class="hint">Loading…</p>`;
  let task;
  try { task = await api("getQuestionTaskDetail", { taskId, memberId: STATE.user.id }); }
  catch (e) { toast(e.message); goTo("dashboard"); return; }

  host.innerHTML = `<h2 class="pane-title" style="margin-top:0">${escapeHtml(task.title)}</h2>`;

  if (task.completed) {
    host.innerHTML += `<p class="hint">✓ Already submitted — thanks!</p>`;
    task.questions.forEach(q => {
      const box = document.createElement("div");
      box.className = "task-card";
      box.innerHTML = `<div class="t-body"><div class="t-desc">${escapeHtml(q.text)}</div><div class="t-meta">${escapeHtml(q.answer)}</div></div>`;
      host.appendChild(box);
    });
    return;
  }

  const form = document.createElement("form");
  form.className = "stack-form";
  task.questions.forEach(q => {
    const label = document.createElement("label");
    label.textContent = `${q.no}. ${q.text}`;
    form.appendChild(label);
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.dataset.no = q.no;
    form.appendChild(ta);
  });
  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn btn-primary btn-block";
  btn.style.marginTop = "18px";
  btn.textContent = "Submit Answers";
  form.appendChild(btn);
  const msg = document.createElement("p");
  msg.className = "hint hidden";
  form.appendChild(msg);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "Submitting…";
    const answers = Array.from(form.querySelectorAll("textarea")).map(t => ({ no: t.dataset.no, answer: t.value.trim() }));
    try {
      const result = await api("submitQuestionAnswers", { taskId, memberId: STATE.user.id, answers });
      toast(`Submitted — +${result.pointsAwarded} pts`);
      goTo("dashboard");
    } catch (err) {
      msg.className = "hint error";
      msg.textContent = err.message;
      msg.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Submit Answers";
    }
  });

  host.appendChild(form);
}

/* ==========================================================
   REPEAT FORM TASK — member view (submit the same form N times)
   ========================================================== */
async function renderRepeatFormPane(taskId) {
  const host = document.getElementById("repeat-form-host");
  host.innerHTML = `<p class="hint">Loading…</p>`;
  let task;
  try { task = await api("getRepeatFormDetail", { taskId }); }
  catch (e) { toast(e.message); goTo("dashboard"); return; }

  paint(task);

  function paint(task) {
    host.innerHTML = `
      <h2 class="pane-title" style="margin-top:0">${escapeHtml(task.title)}</h2>
      <p class="form-progress">Entry ${Math.min(task.progress + 1, task.target)} of ${task.target}${task.completed ? " — all done ✓" : ""}</p>`;

    if (task.completed) {
      const done = document.createElement("p");
      done.className = "hint";
      done.textContent = `All ${task.target} entries collected — thanks!`;
      host.appendChild(done);
      return;
    }

    const form = document.createElement("form");
    form.className = "stack-form";
    const inputs = {};
    task.questions.forEach(q => {
      const label = document.createElement("label");
      label.textContent = q;
      form.appendChild(label);
      const ta = document.createElement("textarea");
      ta.rows = 2;
      form.appendChild(ta);
      inputs[q] = ta;
    });
    const btn = document.createElement("button");
    btn.type = "submit";
    btn.className = "btn btn-primary btn-block";
    btn.style.marginTop = "18px";
    btn.textContent = "Submit entry";
    form.appendChild(btn);
    const msg = document.createElement("p");
    msg.className = "hint hidden";
    form.appendChild(msg);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = "Submitting…";
      const data = {};
      task.questions.forEach(q => { data[q] = inputs[q].value.trim(); });
      try {
        const result = await api("submitForm", { memberId: STATE.user.id, sheet: task.sheet, formType: null, data });
        toast(result.pointsAwarded ? `All entries done — +${result.pointsAwarded} pts!` : `Saved (${result.progress}/${result.target})`);
        task.progress = result.progress;
        task.completed = !!result.pointsAwarded;
        paint(task);
      } catch (err) {
        msg.className = "hint error";
        msg.textContent = err.message;
        msg.classList.remove("hidden");
        btn.disabled = false;
        btn.textContent = "Submit entry";
      }
    });

    host.appendChild(form);
  }
}

/* ==========================================================
   Firebase Cloud Messaging (push notifications)
/* ==========================================================
   Firebase Cloud Messaging (push notifications)
   ========================================================== */
async function setupPushNotifications() {
  if (CONFIG.FIREBASE.apiKey.includes("PASTE_")) return; // not configured yet
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;

  try {
    firebase.initializeApp(CONFIG.FIREBASE);
    const messaging = firebase.messaging();
    const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const token = await messaging.getToken({ vapidKey: CONFIG.VAPID_KEY, serviceWorkerRegistration: registration });
    if (token) await api("registerFcmToken", { memberId: STATE.user.id, token });

    messaging.onMessage((payload) => {
      toast((payload.notification && payload.notification.body) || "New message");
      if (STATE.activePane !== "chat") renderChat(false);
    });
  } catch (err) {
    console.warn("Push setup skipped:", err.message);
  }
}

/* ==========================================================
   Utils
   ========================================================== */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
