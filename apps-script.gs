/* ==========================================================================
  TASKFLOW — Google Apps Script backend
   Deploy: Extensions ▸ Apps Script (inside your Google Sheet) ▸ paste this
   file as Code.gs ▸ Deploy ▸ New deployment ▸ Web app
      - Execute as:  Me
      - Who has access:  Anyone
   Copy the resulting /exec URL into CONFIG.API_URL in backend.js

   Run setup() ONCE from the Apps Script editor (select it in the function
   dropdown ▸ Run) before first use — it creates every sheet + seed data.
   ========================================================================== */

const ADMIN_CODE = "5055";

// After running setup(), paste this Spreadsheet's ID here (Sheet URL, the
// long string between /d/ and /edit). Needed so the web app always opens
// the right file regardless of where it's bound.
const SHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";

// Week point ceilings (must match backend.js WEEK_POINTS)
const WEEK_POINTS = { 1: 10, 2: 10, 3: 5 };

// ---- Members (edit phone numbers here once you have them) ----
const SEED_USERS = [
  { id: "amit",     name: "Amit Rathor",        phone: "6264753201", department: "Buyer Research & Business Development" },
  { id: "narendra", name: "Narendra Jatwa",     phone: "8435560026", department: "Farmer Research & Field Operations" },
  { id: "sanjay",   name: "Sanjay Vishwakarma", phone: "7770910472", department: "Finance & Logistics Operations" },
  { id: "rajsingh", name: "Raj Sendhav",        phone: "7415505769", department: "Product, Tech & Data" }
];

// ---- Optional: Firebase Cloud Messaging (push). Leave blank to skip push. ----
// Paste the full service-account JSON (Firebase console ▸ Project settings ▸
// Service accounts ▸ Generate new private key) as a single-line string into
// Script Properties (File ▸ Project properties ▸ Script properties) under
// the key FCM_SERVICE_ACCOUNT_JSON. Nothing to edit in this file for that.

/* ============================== ROUTER =================================== */

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: "Bad request body" });
  }
  const action = body.action;
  const payload = body.payload || {};

  try {
    const handlers = {
      login: handleLogin,
      getDashboard: handleGetDashboard,
      submitForm: handleSubmitForm,
      getRajTasks: handleGetChecklistTasks,
      toggleRajTask: handleToggleChecklistTask,
      getChat: handleGetChat,
      sendChat: handleSendChat,
      registerFcmToken: handleRegisterFcmToken,
      adminGetTeam: handleAdminGetTeam,
      adminGetMemberDetail: handleAdminGetMemberDetail,
      adminGetSheetUrl: handleAdminGetSheetUrl,
      adminAssignTask: handleAdminAssignTask
    };
    if (!handlers[action]) return respond({ ok: false, error: "Unknown action: " + action });
    const result = handlers[action](payload);
    return respond({ ok: true, result: result });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function doGet() {
  return ContentService.createTextOutput("TaskFlow backend is running.");
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.openById(SHEET_ID); }

/* ============================== AUTH ====================================== */

function handleLogin(p) {
  if (p.type === "admin") {
    if (String(p.code) !== ADMIN_CODE) throw new Error("Incorrect admin code.");
    return { user: { id: "admin", name: "Admin", role: "admin" } };
  }
  const sheet = ss().getSheetByName("Users");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.Phone]).trim() === String(p.phone).trim()) {
      return {
        user: {
          id: rows[i][idx.Member_ID],
          name: rows[i][idx.Name],
          role: "member",
          department: rows[i][idx.Department],
          phone: rows[i][idx.Phone]
        }
      };
    }
  }
  throw new Error("Number not recognised. Ask admin to add you.");
}

/* ============================== DASHBOARD / TASKS ========================= */

function handleGetDashboard(p) {
  return buildMemberDashboard(p.memberId);
}

function buildMemberDashboard(memberId) {
  const sheet = ss().getSheetByName("Tasks");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);

  const tasks = [];
  const weeks = { 1: 0, 2: 0, 3: 0 };
  let totalPoints = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[idx.Member_ID]) !== String(memberId)) continue;
    const completed = r[idx.Completed] === true || r[idx.Completed] === "TRUE";
    const pointsAwarded = Number(r[idx.Points_Awarded]) || 0;
    const week = Number(r[idx.Week]);
    if (completed) { weeks[week] = (weeks[week] || 0) + pointsAwarded; totalPoints += pointsAwarded; }
    tasks.push({
      id: r[idx.Task_ID],
      week: week,
      description: r[idx.Description],
      points: Number(r[idx.Points]),
      type: r[idx.Type],
      target: r[idx.Type] === "COUNT" ? Number(r[idx.Target]) : null,
      progress: r[idx.Type] === "COUNT" ? Number(r[idx.Progress]) || 0 : null,
      completed: completed
    });
  }
  tasks.sort((a, b) => a.week - b.week);
  return { totalPoints, weeks, tasks };
}

/* ============================== FORM SUBMISSIONS =========================== */

function handleSubmitForm(p) {
  const sheet = ss().getSheetByName(p.sheet);
  if (!sheet) throw new Error("Unknown sheet: " + p.sheet);

  const task = findActiveCountTask(p.memberId, p.sheet, p.formType);
  const weekNo = task ? task.week : "";

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = header.map(colName => {
    if (colName === "Timestamp") return new Date();
    if (colName === "Submitted_By") return p.memberId;
    if (colName === "Week_No") return weekNo;
    if (colName === "Form_Type") return p.formType || "";
    const v = p.data[colName];
    return Array.isArray(v) ? v.join(", ") : (v == null ? "" : v);
  });
  sheet.appendRow(row);

  if (!task) return { pointsAwarded: 0, progress: null, target: null };

  const newProgress = task.progress + 1;
  const tasksSheet = ss().getSheetByName("Tasks");
  const tIdx = colIndex(tasksSheet.getRange(1, 1, 1, tasksSheet.getLastColumn()).getValues()[0]);
  tasksSheet.getRange(task.rowIndex + 1, tIdx.Progress + 1).setValue(newProgress);

  if (newProgress >= task.target) {
    tasksSheet.getRange(task.rowIndex + 1, tIdx.Completed + 1).setValue(true);
    tasksSheet.getRange(task.rowIndex + 1, tIdx.Points_Awarded + 1).setValue(task.points);
    return { pointsAwarded: task.points, week: task.week, progress: newProgress, target: task.target };
  }
  return { pointsAwarded: 0, progress: newProgress, target: task.target, week: task.week };
}

// Finds this member's earliest not-yet-completed COUNT task matching the sheet
// (and form_type, for the shared logistics sheet).
function findActiveCountTask(memberId, sheetName, formType) {
  const sheet = ss().getSheetByName("Tasks");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  let best = null;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[idx.Member_ID]) !== String(memberId)) continue;
    if (r[idx.Type] !== "COUNT") continue;
    if (r[idx.Source_Sheet] !== sheetName) continue;
    if (formType && r[idx.Form_Type] !== formType) continue;
    const completed = r[idx.Completed] === true || r[idx.Completed] === "TRUE";
    if (completed) continue;
    if (!best || Number(r[idx.Week]) < best.week) {
      best = {
        rowIndex: i, week: Number(r[idx.Week]), target: Number(r[idx.Target]),
        progress: Number(r[idx.Progress]) || 0, points: Number(r[idx.Points])
      };
    }
  }
  return best;
}

/* ============================== CHECKLIST TASKS (Rajsingh + ad-hoc) ======= */

function handleGetChecklistTasks(p) {
  const sheet = ss().getSheetByName("Tasks");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[idx.Member_ID]) !== String(p.memberId)) continue;
    if (r[idx.Type] !== "CHECKLIST") continue;
    out.push({
      id: r[idx.Task_ID],
      week: Number(r[idx.Week]),
      description: r[idx.Description],
      points: Number(r[idx.Points]),
      completed: r[idx.Completed] === true || r[idx.Completed] === "TRUE"
    });
  }
  out.sort((a, b) => a.week - b.week);
  return out;
}

function handleToggleChecklistTask(p) {
  const sheet = ss().getSheetByName("Tasks");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.Task_ID]) === String(p.taskId)) {
      sheet.getRange(i + 1, idx.Completed + 1).setValue(p.completed);
      sheet.getRange(i + 1, idx.Points_Awarded + 1).setValue(p.completed ? Number(rows[i][idx.Points]) : 0);
      return { ok: true };
    }
  }
  throw new Error("Task not found.");
}

/* ============================== CHAT ======================================= */

function handleGetChat() {
  const sheet = ss().getSheetByName("ChatMessages");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  const start = Math.max(1, rows.length - 50);
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r[idx.Text]) continue;
    out.push({
      senderId: r[idx.Sender_ID],
      senderName: r[idx.Sender_Name],
      text: r[idx.Text],
      time: Utilities.formatDate(new Date(r[idx.Timestamp]), Session.getScriptTimeZone(), "HH:mm")
    });
  }
  return out;
}

function handleSendChat(p) {
  const sheet = ss().getSheetByName("ChatMessages");
  sheet.appendRow([Utilities.getUuid(), p.senderId, p.senderName, p.text, new Date()]);
  try { notifyOthers(p.senderId, p.senderName, p.text); } catch (e) { /* push is best-effort */ }
  return { ok: true };
}

function notifyOthers(senderId, senderName, text) {
  const usersSheet = ss().getSheetByName("Users");
  const rows = usersSheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.Member_ID]) === String(senderId)) continue;
    const token = rows[i][idx.FCM_Token];
    if (token) sendFcmPush(token, senderName, text);
  }
}

function handleRegisterFcmToken(p) {
  const sheet = ss().getSheetByName("Users");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.Member_ID]) === String(p.memberId)) {
      sheet.getRange(i + 1, idx.FCM_Token + 1).setValue(p.token);
      return { ok: true };
    }
  }
  return { ok: false };
}

/* ============================== ADMIN ======================================= */

function handleAdminGetTeam() {
  const sheet = ss().getSheetByName("Users");
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i][idx.Member_ID];
    const dash = buildMemberDashboard(id);
    out.push({ id, name: rows[i][idx.Name], department: rows[i][idx.Department], totalPoints: dash.totalPoints });
  }
  return out;
}

function handleAdminGetMemberDetail(p) {
  const usersSheet = ss().getSheetByName("Users");
  const rows = usersSheet.getDataRange().getValues();
  const header = rows[0];
  const idx = colIndex(header);
  let name = "", department = "";
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.Member_ID]) === String(p.memberId)) {
      name = rows[i][idx.Name]; department = rows[i][idx.Department];
    }
  }
  const dash = buildMemberDashboard(p.memberId);
  return { name, department, totalPoints: dash.totalPoints, tasks: dash.tasks };
}

function handleAdminGetSheetUrl() {
  return { url: ss().getUrl() };
}

function handleAdminAssignTask(p) {
  const sheet = ss().getSheetByName("Tasks");
  const id = "T" + new Date().getTime();
  const aim = String(p.aim || "").trim();
  const taskDetail = String(p.description || "").trim();
  if (!taskDetail) throw new Error("Task detail is required.");
  const finalDescription = aim ? `Aim: ${aim} | Task: ${taskDetail}` : taskDetail;
  sheet.appendRow([id, p.memberId, p.week, "CHECKLIST", finalDescription, "", p.points, false, "", 0, "", ""]);
  return { ok: true, taskId: id };
}

/* ============================== FCM PUSH (HTTP v1, optional) ================ */

function sendFcmPush(token, title, body) {
  const props = PropertiesService.getScriptProperties();
  const saJson = props.getProperty("FCM_SERVICE_ACCOUNT_JSON");
  if (!saJson) return; // push not configured — silently skip
  const sa = JSON.parse(saJson);
  const accessToken = getGoogleAccessToken(sa);

  UrlFetchApp.fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + accessToken },
      payload: JSON.stringify({
        message: { token: token, notification: { title: "TaskFlow · " + title, body: body } }
      }),
      muteHttpExceptions: true
    }
  );
}

function getGoogleAccessToken(serviceAccount) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const b64 = obj => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, "");
  const unsigned = b64(header) + "." + b64(claim);
  const signature = Utilities.computeRsaSha256Signature(unsigned, serviceAccount.private_key);
  const jwt = unsigned + "." + Utilities.base64EncodeWebSafe(signature).replace(/=+$/, "");

  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }
  });
  return JSON.parse(res.getContentText()).access_token;
}

/* ============================== UTIL ======================================= */

function colIndex(header) {
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  return idx;
}

/* ============================== ONE-TIME SETUP ============================== */

function setup() {
  const book = SHEET_ID.includes("PASTE_") ? SpreadsheetApp.create("TaskFlow Data") : ss();
  if (SHEET_ID.includes("PASTE_")) {
    Logger.log("Created new sheet. Copy this ID into SHEET_ID: " + book.getId());
  }

  makeSheet(book, "Users", ["Member_ID", "Name", "Phone", "Department", "FCM_Token"],
    SEED_USERS.map(u => [u.id, u.name, u.phone, u.department, ""]));

  makeSheet(book, "Tasks",
    ["Task_ID", "Member_ID", "Week", "Type", "Description", "Source_Sheet", "Points", "Completed", "Form_Type", "Progress", "Target", "Points_Awarded"],
    [
      ["T-amit-1", "amit", 1, "COUNT", "Collect data from 10 restaurants/hotels/dhabas", "Sheet1_Restaurant", 10, false, "", 0, 10, ""],
      ["T-narendra-1", "narendra", 1, "COUNT", "Collect data from 10 farmers", "Sheet2_Farmers", 10, false, "", 0, 10, ""],
      ["T-sanjay-1", "sanjay", 1, "COUNT", "Form A — 3 verified quotes per cost item (6 items)", "Sheet3_Logistics", 10, false, "Cost_Verification", 0, 18, ""],
      ["T-sanjay-2", "sanjay", 2, "COUNT", "Form B — verified source for each compliance item (4 items)", "Sheet3_Logistics", 10, false, "Compliance_Legal", 0, 4, ""],
      ["T-sanjay-3", "sanjay", 3, "COUNT", "Form C — break-even inputs (fixed cost, margin, spoilage)", "Sheet3_Logistics", 5, false, "Breakeven_Input", 0, 3, ""],
      ["T-raj-1a", "rajsingh", 1, "CHECKLIST", "Central data sheet structure", "", 2, false, "", "", "", ""],
      ["T-raj-1b", "rajsingh", 1, "CHECKLIST", "MVP scope draft", "", 2, false, "", "", "", ""],
      ["T-raj-1c", "rajsingh", 1, "CHECKLIST", "Break-even calculator skeleton", "", 2, false, "", "", "", ""],
      ["T-raj-1d", "rajsingh", 1, "CHECKLIST", "Tech stack architecture doc", "", 2, false, "", "", "", ""],
      ["T-raj-1e", "rajsingh", 1, "CHECKLIST", "SOP draft — farmer onboarding", "", 2, false, "", "", "", ""]
    ]
  );

  makeSheet(book, "Sheet1_Restaurant",
    ["Timestamp", "Submitted_By", "Week_No", "Type", "Business_Name", "Location", "Contact_Number",
     "Requirement_Kg", "Sourcing_Problems", "Order_Issues_Count", "Willing_To_Pay_Extra", "Trial_Batch_Ready", "Other_Insights"], []);

  makeSheet(book, "Sheet2_Farmers",
    ["Timestamp", "Submitted_By", "Week_No", "Farmer_Name", "Mobile_Number", "Village_Address",
     "Selling_Method", "Waste_Percent", "Advance_Payment_Needed", "Willing_To_Switch"], []);

  makeSheet(book, "Sheet3_Logistics",
    ["Timestamp", "Submitted_By", "Week_No", "Form_Type", "Item", "Source_Contact", "Quoted_Amount", "Quote_Date", "Status",
     "Requirement", "Process_Steps", "Cost", "Timeline", "Source_Verified_From",
     "Input_Type", "Value", "Source"], []);

  makeSheet(book, "ChatMessages", ["Msg_ID", "Sender_ID", "Sender_Name", "Text", "Timestamp"], []);

  Logger.log("Setup complete. Spreadsheet URL: " + book.getUrl());
}

function makeSheet(book, name, header, seedRows) {
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  sheet.clear();
  sheet.appendRow(header);
  sheet.setFrozenRows(1);
  seedRows.forEach(r => sheet.appendRow(r));
}
