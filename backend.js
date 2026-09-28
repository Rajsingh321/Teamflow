/* ==========================================================
  TASKFLOW — client controller
   Talks to a Google Apps Script Web App (acts as backend + DB
   via Google Sheets) and to Firebase Cloud Messaging (push).

   >>> FILL THESE THREE THINGS IN BEFORE DEPLOYING <<<
   ========================================================== */
const CONFIG = {
  // Paste the URL you get after deploying apps-script.gs as a Web App
  API_URL: "https://script.google.com/macros/s/AKfycbyIvtb5ikE2-cSzApoQIAie4kpQnxMb0qSgVYJqkATI_DGbU6ZVu-EpgvZpvqZhoJP5/exec",

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

const PANE_IDS = ["dashboard", "form", "chat", "profile", "admin-team", "admin-detail", "admin-assign"];

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
  if (pane === "admin-assign") await renderAdminAssign();

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
    list.appendChild(card);
  });
  if (!d.tasks || !d.tasks.length) {
    list.innerHTML = `<p class="hint">No tasks assigned yet.</p>`;
  }
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
  (detail.tasks || []).forEach(t => {
    const card = document.createElement("div");
    card.className = "task-card" + (t.completed ? " is-done" : "");
    card.innerHTML = `
      <div class="t-body">
        <div class="t-desc">${escapeHtml(t.description)}</div>
        <div class="t-meta">Week ${t.week} · ${t.points} pts${t.progress != null ? ` · ${t.progress}/${t.target}` : ""}</div>
      </div>
      <span class="pill ${t.completed ? "done" : ""}">${t.completed ? "Done" : "Pending"}</span>`;
    list.appendChild(card);
  });
}

async function renderAdminAssign() {
  const select = document.getElementById("assign-member");
  if (!select.options.length) {
    try {
      const members = await api("adminGetTeam", {});
      select.innerHTML = members.map(m => `<option value="${m.id}">${escapeHtml(m.name)} — ${escapeHtml(getMemberRoleLabel(m))}</option>`).join("");
    } catch (e) { toast(e.message); }
  }
}

function wireStaticForms() {
  document.getElementById("form-assign-task").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      memberId: document.getElementById("assign-member").value,
      week: Number(document.getElementById("assign-week").value),
      description: document.getElementById("assign-desc").value.trim(),
      points: Number(document.getElementById("assign-points").value)
    };
    const msg = document.getElementById("assign-msg");
    try {
      await api("adminAssignTask", payload);
      msg.className = "hint";
      msg.textContent = "Task assigned.";
      document.getElementById("form-assign-task").reset();
      toast("Task assigned");
    } catch (err) {
      msg.className = "hint error";
      msg.textContent = err.message;
    }
    msg.classList.remove("hidden");
  }, { once: false });
}

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