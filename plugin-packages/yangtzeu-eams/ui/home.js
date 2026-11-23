const HOME_ORIGIN = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
const HOME_DIRECT_ORIGIN = "https://jwc3.yangtzeu.edu.cn";
const HOME_PATHS = {
  overview: "/eams/stdDetail.action",
  grades: "/eams/teach/grade/course/person.action",
  plan: "/eams/myPlanByMajor.action",
  credits: "/eams/myPlanCompl.action",
  exams: null,
  // Found through the academic menu, so the page follows wherever the school puts it.
  external: null,
};
/** Menu labels for sections whose address is read from the academic home page. */
const HOME_MENU_ENTRIES = {
  // The school lists qualification exam results (e.g. CET-4/6) under "校外考试".
  external: /校外考试|校外考試|校外成绩|校外成績/,
  exams: /我的考试|我的考試|考试安排|考試安排|考试查询|考試查詢/,
};
const HOME_MAX_PAGES = 12;
const HOME_MAX_ROWS = 3000;

function language(ctx) {
  const tag = String(ctx.settings && ctx.settings.language || "zh-CN");
  return /^zh.*(?:TW|HK|Hant)/i.test(tag) ? "zh-TW" : /^zh/i.test(tag) ? "zh-CN" : "en";
}

function words(ctx, zh, tw, en) {
  return ({ "zh-CN": zh, "zh-TW": tw, en })[language(ctx)];
}

function clean(value) {
  return String(value == null ? "" : value).replace(/\u00a0/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
}

function docOf(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  doc.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
  return doc;
}

function parseHomeAccount(html) {
  const doc = docOf(html);
  const header = clean(doc.body.textContent).slice(0, 5000);
  if (!/我的账户|我的帐户|我的賬戶|退出|logout|学籍信息|學籍資訊/i.test(header)) return null;
  const match = header.match(/([^\s()（）]{1,40})\s*[(（]\s*(\d{7,25})\s*[)）]\s*(?:学生|本科生|研究生|Student)/i);
  if (!match) return null;
  return { id: match[2], number: match[2], name: match[1], school: "长江大学" };
}

function matrixOf(table) {
  const matrix = [];
  Array.from(table.rows).forEach((row, r) => {
    matrix[r] = matrix[r] || [];
    let c = 0;
    Array.from(row.cells).forEach((cell) => {
      while (matrix[r][c]) c++;
      const value = clean(cell.textContent);
      for (let i = 0; i < Math.min(cell.rowSpan || 1, 100); i++) {
        matrix[r + i] = matrix[r + i] || [];
        for (let j = 0; j < Math.min(cell.colSpan || 1, 24); j++) matrix[r + i][c + j] = value;
      }
      c += cell.colSpan || 1;
    });
  });
  return matrix;
}

const HEADER_TERMS = /课程|課程|考试|考試|科目|成绩|成績|学分|學分|绩点|績點|学期|學期|时间|時間|地点|地點|性质|性質|类别|類別|要求|完成|获得|獲得|培养|培養|Course|Credit|Grade|Score|GPA|Semester|Exam|Date|Room/i;
const EMPTY_TEXT = /暂无(?:成绩|数据|记录|课程)|没有(?:成绩|数据|记录)|無(?:成績|資料|記錄)|查无数据|No (?:records|data|results)/i;

const MARK = /^[√✓✔●○◎☑]$/;
const SUMMARY_LABEL = /小计|總計|总计|合计|合計|应修学分|應修學分|全程|Subtotal|Total/i;

/**
 * Curriculum tables put one column per term under a spanning header and tick the term with a mark.
 * Collapse such a group into one column holding the ticked term numbers, and lift subtotal rows out
 * of the course list. Returns null when the table does not have that shape.
 */
function collapseTermGroups(matrix, headerRow) {
  const head = matrix[headerRow] || [];
  const groups = [];
  for (let i = 0; i < head.length;) {
    let j = i;
    while (j + 1 < head.length && head[i] && head[j + 1] === head[i]) j++;
    if (j - i >= 2) groups.push([i, j]);
    i = j + 1;
  }
  if (!groups.length) return null;
  const sub = matrix[headerRow + 1] || [];
  const hasSub = groups.every(([a, b]) => {
    const labels = sub.slice(a, b + 1);
    return labels.every((label) => label && label.length <= 6 && label !== head[a]) && new Set(labels).size === labels.length;
  });
  const bodyStart = headerRow + (hasSub ? 2 : 1);
  const isSummary = (row) => SUMMARY_LABEL.test((row || []).slice(0, 3).join(" "));
  const body = matrix.slice(bodyStart).filter((row) => row && row.some(Boolean));
  const courses = body.filter((row) => !isSummary(row));
  const qualifies = groups.every(([a, b]) => {
    let marks = 0;
    for (const row of courses) {
      for (let c = a; c <= b; c++) {
        if (!row[c]) continue;
        if (!MARK.test(row[c])) return false;
        marks++;
      }
    }
    return marks > 0;
  });
  if (!qualifies) return null;
  const creditCol = head.findIndex((label) => /学分|學分|Credit/i.test(label));
  const inGroup = (c) => groups.find(([a, b]) => c >= a && c <= b);
  const collapse = (row, mapGroup) => {
    const out = [];
    for (let c = 0; c < head.length; c++) {
      const group = inGroup(c);
      if (!group) out.push(row[c] || "");
      else if (c === group[0]) out.push(mapGroup(group));
    }
    return out;
  };
  const termNumber = (group, c) => (hasSub ? sub[c] : String(c - group[0] + 1));
  const rows = [collapse(head, ([a]) => head[a])];
  const summary = [];
  for (const row of body) {
    if (isSummary(row)) {
      const label = row.slice(0, Math.max(creditCol, 1)).filter((cell, i, all) => cell && all.indexOf(cell) === i).join("");
      const value = creditCol >= 0 ? row[creditCol] : "";
      if (label && /^\d+(?:\.\d+)?$/.test(value || "")) summary.push({ label, value });
      continue;
    }
    if (/^备注|^備註/.test(row[0] || "") && row.slice(1).every((cell) => !cell || cell === row[0])) continue;
    rows.push(collapse(row, (group) => {
      const ticked = [];
      for (let c = group[0]; c <= group[1]; c++) if (MARK.test(row[c] || "")) ticked.push(termNumber(group, c));
      return ticked.join("、");
    }));
  }
  return { matrix: rows, summary: summary.slice(0, 12) };
}

/**
 * A credit report lists each category (e.g. "一 必修") with its required and earned credits above the
 * numbered courses under it. Categories become summary tiles; only numbered rows are records.
 * Returns null when the table has no numbered 序号 column, so other layouts keep their rows.
 */
function splitCreditRows(rows, columns) {
  if (columns[0] !== "序号") return null;
  const required = columns.findIndex((column) => /要求学分/.test(column));
  const earned = columns.findIndex((column) => /实修学分|已获得学分/.test(column));
  const courses = [];
  const summary = [];
  for (const row of rows) {
    if (/^\d+$/.test(row[0])) {
      courses.push(row);
      continue;
    }
    const label = (row[0] || "").trim();
    if (!label) continue;
    summary.push({ label, value: `${(earned >= 0 && row[earned]) || "0"} / ${(required >= 0 && row[required]) || "0"}` });
  }
  return courses.length ? { courses, summary } : null;
}

/** Page-level totals (earned / required credits and GPA) from the student header table. */
function creditTotals(doc) {
  const totals = [];
  for (const cell of doc.querySelectorAll("td,th")) {
    const text = clean(cell.textContent).replace(/[:：]$/, "");
    const value = cell.nextElementSibling ? clean(cell.nextElementSibling.textContent) : "";
    if (!value) continue;
    if (text === "要求学分/实修学分") {
      // The school writes required first; show earned / required like every category card.
      const [required, earned] = value.split("/").map((part) => part.trim());
      totals.push(earned != null && earned !== ""
        ? { label: "实修学分 / 要求学分", value: `${earned} / ${required}` }
        : { label: "要求学分 / 实修学分", value });
    } else if (text === "GPA") {
      totals.push({ label: "GPA", value });
    }
  }
  return totals;
}

function tableResult(html, sectionId) {
  const doc = docOf(html);
  const candidates = [];
  for (const table of doc.querySelectorAll("table")) {
    if (table.querySelector("table")) continue;
    let hidden = false;
    for (let parent = table; parent; parent = parent.parentElement) {
      if (parent.hidden || /display\s*:\s*none/i.test(parent.getAttribute("style") || "") || parent.getAttribute("aria-hidden") === "true") hidden = true;
    }
    if (hidden) continue;
    let matrix = matrixOf(table);
    let headerRow = -1, score = 0;
    for (let r = 0; r < Math.min(matrix.length, 5); r++) {
      const row = matrix[r] || [];
      const joined = row.join(" ");
      const topic = sectionId === "grades" || sectionId === "external" ? /成绩|成績|总评|總評|绩点|績點|Grade|Score|GPA/i.test(joined)
        : sectionId === "exams" ? /考试|考試|科目|课程|課程|时间|時間|地点|地點|Exam|Date|Room/i.test(joined)
        : sectionId === "credits" ? /学分|學分|Credit/i.test(joined)
        : /课程|課程|学分|學分|Course|Credit/i.test(joined);
      if (!topic) continue;
      const next = row.filter((cell) => HEADER_TERMS.test(cell)).length;
      if (next >= 2 && next > score) { headerRow = r; score = next; }
    }
    if (headerRow < 0) continue;
    let summary = [];
    if (sectionId === "plan" || sectionId === "credits") {
      const collapsed = collapseTermGroups(matrix, headerRow);
      if (collapsed) {
        matrix = [...matrix.slice(0, headerRow), ...collapsed.matrix];
        summary = collapsed.summary;
      }
    }
    const columns = matrix[headerRow].map((text) => text || "—");
    if (columns.length > 24) continue;
    let rows = matrix.slice(headerRow + 1).filter((row) =>
      row.some(Boolean) && !EMPTY_TEXT.test(row.join(" ")) && row.join("|") !== columns.join("|"),
    ).map((row) => Array.from({ length: columns.length }, (_, c) => row[c] || ""));
    // Credit reports: category rows carry the totals, numbered rows are the courses.
    const credit = sectionId === "credits" ? splitCreditRows(rows, columns) : null;
    if (credit) {
      rows = credit.courses;
      summary = [...creditTotals(doc), ...credit.summary];
    }
    // A header-only AJAX shell is not proof that the student has no results.
    if (!rows.length && !EMPTY_TEXT.test(clean(table.textContent))) continue;
    // Keep the record name first, rather than a row number, checkbox or action column.
    const nameCol = columns.findIndex((column) => /课程名称|課程名稱|课程名|課程名|考试课程|考試課程|考试科目|考試科目|科目|^课程$|^課程$|Course.*Name|^Course$|Exam.*Name/i.test(column));
    const order = columns.map((_, i) => i).filter((i) => !/^(?:序号|序號|编号|編號|选择|選擇|操作|No\.?|Action)$/i.test(columns[i]));
    if (nameCol >= 0 && order.includes(nameCol)) order.splice(order.indexOf(nameCol), 1), order.unshift(nameCol);
    if (order.length < 2) continue;
    if (rows.some((row) => !row[order[0]])) continue;
    // Plan tables prefix each course name with its running number; the number is not part of the name.
    const names = nameCol >= 0 ? rows.map((row) => row[nameCol]) : [];
    if (names.length && names.filter((name) => /^\d+\s+\S/.test(name)).length >= names.length * 0.8) {
      rows.forEach((row) => { row[nameCol] = row[nameCol].replace(/^\d+\s+/, ""); });
    }
    candidates.push({
      columns: order.map((i) => columns[i]),
      rows: rows.map((row) => order.map((i) => row[i])),
      summary,
      score: score + rows.length,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) return candidates[0];
  return null;
}

function objectRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["rows", "records", "courseGrades", "grades", "data", "result"]) {
    const found = objectRows(value[key]);
    if (found) return found;
  }
  return null;
}

function gradeJsonResult(source, ctx) {
  let parsed;
  try { parsed = JSON.parse(source); } catch (_) { return null; }
  if (parsed && (parsed.success === false || parsed.ok === false ||
      Number(parsed.code) >= 400 || /^(?:error|failed|failure)$/i.test(parsed.status || "") || parsed.error)) {
    throw new Error(words(ctx, "教务系统未能完成查询，上次结果保持不变。", "教務系統未能完成查詢，上次結果保持不變。",
      "The academic query failed. The previous result is unchanged."));
  }
  const records = objectRows(parsed);
  if (!records) return null;
  const get = (record, paths) => {
    for (const path of paths) {
      const direct = record[path];
      const value = direct == null ? path.split(".").reduce((v, key) => v && v[key], record) : direct;
      if (value != null && typeof value !== "object") return clean(value);
    }
    return "";
  };
  const rows = records.map((record) => [
    get(record, ["courseName", "course.name", "lesson.course.name", "name"]),
    get(record, ["score", "grade", "gaText", "scoreText", "totalScore"]),
    get(record, ["credit", "credits", "course.credits", "course.credit"]),
    get(record, ["gp", "gpa", "gradePoint"]),
    get(record, ["semesterName", "semester.name", "semester"]),
  ]);
  if (rows.some((row) => !row[0] || !row[1])) return null;
  let total = rows.length;
  function inspectTotals(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of ["total", "totalCount", "totalRows"]) {
      const number = Number(value[key]);
      if (Number.isFinite(number)) total = Math.max(total, number);
    }
    for (const key of ["data", "result"]) inspectTotals(value[key]);
  }
  inspectTotals(parsed);
  if (total > rows.length) throw new Error(words(ctx,
    "成绩还有分页未读取完整。请打开教务页面完成查询后保存。", "成績還有分頁未讀取完整。請開啟教務頁面完成查詢後儲存。",
    "More grade pages are available. Open the academic page and save the completed query."));
  return {
    columns: words(ctx, ["课程名称", "成绩", "学分", "绩点", "学期"],
      ["課程名稱", "成績", "學分", "績點", "學期"], ["Course", "Grade", "Credits", "Grade point", "Semester"]),
    rows,
  };
}

function overviewResult(html, ctx) {
  const doc = docOf(html);
  const rows = [];
  for (const row of doc.querySelectorAll("tr")) {
    const cells = Array.from(row.cells).map((cell) => clean(cell.textContent));
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const label = cells[i].replace(/[:：]$/, "");
      const validLabel = label && label.length <= 24 && !/^(?:序号|序號|课程|課程|成绩|成績|学分|學分|绩点|績點|操作|Action|No\.?|项|項)$/.test(label);
      if (validLabel && cells[i + 1]) {
        rows.push([label, cells[i + 1]]);
      }
    }
  }
  return rows.length ? {
    columns: words(ctx, ["项目", "内容"], ["項目", "內容"], ["Field", "Value"]),
    rows,
  } : null;
}

function gradeSemesterSummary(html, ctx) {
  const doc = docOf(html);
  for (const table of doc.querySelectorAll("table")) {
    const rows = Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => clean(cell.textContent)))
      .filter((row) => row.length >= 3 && row.some(Boolean));
    if (rows.length < 2) continue;
    const headerText = rows[0].join(" ");
    // The school may merge the header cells, so the marker can sit in one cell or spread across two.
    if (!/学年|學年/.test(headerText) || !/学期|學期/.test(headerText)) continue;
    // Any row that only names the columns is a header; the last one carries the column labels.
    const headerRows = rows.filter((row) => {
      const text = row.join(" ");
      return !/^\d{4}\s*[-/]\s*\d{4}/.test(row[0] || "") && /学年|學年|学期|學期|绩点|績點|学分|學分|门数|門數/.test(text);
    });
    const columns = headerRows.length ? headerRows[headerRows.length - 1] : rows[0];
    const body = rows
      .filter((row) => !headerRows.includes(row) && row !== rows[0])
      .filter((row) => row[0] && (/^\d{4}\s*[-/]\s*\d{4}/.test(row[0]) || /在校|在學|合计|合計|总计|總計/.test(row[0])));
    if (!body.length) continue;
    return { title: words(ctx, "学年学期汇总", "學年學期彙總", "Semester summary"), columns, rows: body };
  }
  return null;
}

/** The "view all semesters" link on the grade page; its table carries each term's GPA. */
function allSemestersLink(html, base, scope) {
  const doc = docOf(html);
  for (const a of doc.querySelectorAll("a[href]")) {
    const text = clean(a.textContent) || clean(a.getAttribute("title"));
    if (!/所有学期|所有學期|查看所有|學期成績|学期成绩|全部学期|全部學期/.test(text)) continue;
    const url = allowedReadUrl(a.getAttribute("href"), base, "grades", scope);
    if (url) return url;
  }
  return null;
}

function parseSectionPage(html, sectionId, ctx) {
  let result = sectionId === "overview" ? overviewResult(html, ctx) :
    (sectionId === "grades" || sectionId === "external" ? gradeJsonResult(html, ctx) : null) || tableResult(html, sectionId);
  if (!result && EMPTY_TEXT.test(clean(docOf(html).body.textContent))) {
    result = { columns: words(ctx, ["项目", "内容"], ["項目", "內容"], ["Field", "Value"]), rows: [] };
  }
  if (result && sectionId === "grades") {
    const semesterSummary = gradeSemesterSummary(html, ctx);
    if (semesterSummary) result.semesterSummary = semesterSummary;
  }
  return result;
}

function allowedReadUrl(value, base, sectionId, scope) {
  let url;
  try { url = new URL(value, base); } catch (_) { return null; }
  if (![HOME_ORIGIN, HOME_DIRECT_ORIGIN].includes(url.origin) || !url.pathname.startsWith("/eams/")) return null;
  if (/(?:[!/])(?:save|remove|delete|update|submit|add|apply|change|report|print|export|download)/i.test(url.pathname)) return null;
  // A menu-found section only follows pages under the address the menu gave.
  const relevant = scope ? url.pathname.startsWith(scope)
    : sectionId === "grades" ? /grade|Grade/.test(url.pathname)
    : sectionId === "plan" ? /plan|Plan/.test(url.pathname)
    : sectionId === "credits" ? /plan|Plan|credit|Credit/.test(url.pathname)
    : /stdDetail/.test(url.pathname);
  if (!relevant) return null;
  url.hash = "";
  // The school's web proxy rewrites URL.origin/href to the internal address.
  return HOME_ORIGIN + url.pathname + url.search;
}

function queryLinks(html, base, sectionId, scope) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = [];
  for (const a of doc.querySelectorAll("a[href],iframe[src]")) {
    const url = allowedReadUrl(a.getAttribute("href") || a.getAttribute("src"), base, sectionId, scope);
    if (url) found.push({ url, method: "GET" });
  }
  // Server-generated query forms are read only. Never follow save/apply actions.
  for (const form of doc.querySelectorAll("form[action]")) {
    const url = allowedReadUrl(form.getAttribute("action"), base, sectionId, scope);
    if (!url) continue;
    const body = new URLSearchParams();
    for (const input of form.querySelectorAll("input[name],select[name]")) {
      if (input.type === "password" || /submit|button|file/.test(input.type)) continue;
      if (/^(?:checkbox|radio)$/.test(input.type) && !input.checked) continue;
      const all = input.tagName === "SELECT" ? Array.from(input.options).find((o) => /^全部|所有|All$/i.test(clean(o.textContent))) : null;
      body.set(input.name, all ? all.value : input.value || "");
    }
    if ((form.method || "").toUpperCase() === "POST") found.push({ url, method: "POST", body: body.toString() });
    else {
      const target = new URL(url);
      body.forEach((value, key) => target.searchParams.set(key, value));
      found.push({ url: HOME_ORIGIN + target.pathname + target.search, method: "GET" });
    }
  }
  // AJAX table URLs may be declared in scripts instead of links.
  const scripts = Array.from(doc.querySelectorAll("script")).map((script) => script.textContent).join("\n");
  for (const match of scripts.matchAll(/["']([^"'\r\n]*(?:grade|Grade|plan|Plan)[^"'\r\n]*\.action(?:\?[^"'\r\n]*)?)["']/g)) {
    const url = allowedReadUrl(match[1], base, sectionId, scope);
    if (url) found.push({ url, method: "GET" });
  }
  // The EAMS landing page also advertises reports and a narrower current-semester query.
  const history = sectionId === "grades" ? found.filter((page) =>
    /\/person!historyCourseGrade(?:Table)?\.action$/.test(new URL(page.url).pathname),
  ) : [];
  const selected = history.length ? history : found;
  return selected.filter((page, index) => selected.findIndex((other) =>
    other.url === page.url && other.method === page.method && other.body === page.body,
  ) === index);
}

async function readPage(ctx, url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await ctx.network.fetch(url, {
      cache: "no-store",
      ...options,
      headers: { ...(options.method === "POST" ? { "X-Requested-With": "XMLHttpRequest" } : {}), ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(words(ctx, `教务系统返回 HTTP ${response.status}`, `教務系統傳回 HTTP ${response.status}`,
      `The academic system returned HTTP ${response.status}`));
    const html = await response.text();
    if (html.length > 2 * 1024 * 1024) throw new Error(words(ctx, "查询结果过大，请缩小查询范围。", "查詢結果過大，請縮小查詢範圍。",
      "The response is too large. Narrow your query."));
    if (!/请不要过快点击|請不要過快點擊|操作过于频繁|操作過於頻繁/.test(clean(docOf(html).body.textContent))) return html;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw new Error(words(ctx, "教务系统暂时限制了连续查询，请稍后刷新。本机上次结果已保留。",
    "教務系統暫時限制了連續查詢，請稍後重新整理。本機上次結果已保留。",
    "The academic system is limiting repeated requests. Try refreshing shortly. Your previous local result is unchanged."));
}

/**
 * The address of a menu entry on the academic home page, plus the path prefix its pages share
 * (e.g. "/eams/stdOtherGrade" for "/eams/stdOtherGrade!search.action").
 */
function menuEntry(html, pattern) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  for (const a of doc.querySelectorAll("a[href]")) {
    if (!pattern.test(clean(a.textContent) || clean(a.getAttribute("title")))) continue;
    let url;
    try { url = new URL(a.getAttribute("href"), HOME_ORIGIN + "/eams/home.action"); } catch (_) { continue; }
    if (![HOME_ORIGIN, HOME_DIRECT_ORIGIN].includes(url.origin) || !/^\/eams\/[^?#]+\.action$/.test(url.pathname)) continue;
    return { url: HOME_ORIGIN + url.pathname + url.search, scope: url.pathname.replace(/(?:!.*)?\.action$/, "") };
  }
  return null;
}

async function resolveMenuEntry(ctx, html, pattern) {
  const direct = menuEntry(html, pattern);
  if (direct) return direct;
  if (!/home!submenus\.action\?menu\.id=/.test(html)) return null;
  const submenu = await readPage(ctx, HOME_ORIGIN + "/eams/home!submenus.action?menu.id=", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  return menuEntry(submenu, pattern);
}

/** The academic home page. The loaded document is used only when it already shows the account, as in [currentAccount]. */
async function homePage(ctx) {
  if (typeof document !== "undefined" && typeof location !== "undefined" &&
      location.origin === HOME_ORIGIN && location.pathname === "/eams/home.action") {
    const loaded = document.documentElement.outerHTML;
    if (parseHomeAccount(loaded) && menuEntry(loaded, /./)) return loaded;
  }
  return readPage(ctx, HOME_ORIGIN + "/eams/home.action");
}

async function currentAccount(ctx, preferEntryDocument = false) {
  if (preferEntryDocument && typeof document !== "undefined" && typeof location !== "undefined" &&
      location.origin === HOME_ORIGIN && location.pathname === "/eams/home.action") {
    const loaded = parseHomeAccount(document.documentElement.outerHTML);
    if (loaded) return loaded;
  }
  const html = await readPage(ctx, HOME_ORIGIN + "/eams/home.action");
  return parseHomeAccount(html);
}

export async function checkLogin(ctx) {
  const account = await currentAccount(ctx, true);
  return { loggedIn: Boolean(account), account };
}

export async function sync(ctx) {
  const id = ctx.action && ctx.action.sectionId;
  if (!Object.prototype.hasOwnProperty.call(HOME_PATHS, id)) throw new Error("Invalid section");
  const captured = ctx.action.pageHtml;
  let account, start = HOME_PATHS[id] ? HOME_ORIGIN + HOME_PATHS[id] : null, scope;
  if (captured) {
    account = parseHomeAccount(captured);
  } else if (start) {
    account = await currentAccount(ctx, true);
  } else {
    // One home page read gives both the account and the menu address.
    const home = await homePage(ctx);
    account = parseHomeAccount(home);
    const entry = account && await resolveMenuEntry(ctx, home, HOME_MENU_ENTRIES[id]);
    if (account && !entry) throw new Error(words(ctx,
      "教务系统菜单里没有找到这一项。请打开教务页面，进入查询后点击「保存当前查询」。",
      "教務系統選單裡沒有找到這一項。請開啟教務頁面，進入查詢後點擊「儲存目前查詢」。",
      "This item is not in the academic menu. Open the academic page, run the query, then save the current query."));
    if (entry) { start = entry.url; scope = entry.scope; }
  }
  if (!account) return { loggedIn: false };
  const queue = [{ url: start, method: "GET" }];
  const visited = new Set();
  let semesterSummary = null;
  const results = [];
  let pages = 0;
  while (queue.length && pages < HOME_MAX_PAGES) {
    const page = queue.shift();
    const key = page.method + " " + page.url + " " + (page.body || "");
    if (visited.has(key)) continue;
    visited.add(key);
    const html = captured || await readPage(ctx, page.url, page.method === "POST" ? {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: page.body,
    } : {});
    pages++;
    const parsed = parseSectionPage(html, id, ctx);
    if (parsed) results.push(parsed);
    // The per-semester GPA table lives behind the grade page's "all semesters" link, not on the list itself.
    if (id === "grades" && !semesterSummary && !captured) {
      const link = allSemestersLink(html, page.url, scope);
      if (link && pages < HOME_MAX_PAGES) {
        pages++;
        semesterSummary = gradeSemesterSummary(await readPage(ctx, link), ctx);
      }
    }
    if (captured) break;
    for (const next of queryLinks(html, page.url, id, scope)) {
      const nextKey = next.method + " " + next.url + " " + (next.body || "");
      if (!visited.has(nextKey)) queue.push(next);
    }
  }
  if (queue.some((page) => !visited.has(page.method + " " + page.url + " " + (page.body || "")))) throw new Error(words(ctx, "结果分页较多，请打开教务页面完成查询后保存。",
    "結果分頁較多，請開啟教務頁面完成查詢後儲存。", "More pages remain. Open the academic page and save the completed query."));
  if (!results.length) throw new Error(words(ctx,
    "没有读取到完整结果。请点击「打开教务页面」，完成查询后点击「保存当前查询」。",
    "沒有讀取到完整結果。請點擊「開啟教務頁面」，完成查詢後點擊「儲存目前查詢」。",
    "No complete result was found. Open the academic page, run your query, then save the current query."));
  const primary = results.reduce((best, result) => result.rows.length > best.rows.length ? result : best);
  if (semesterSummary && !primary.semesterSummary) primary.semesterSummary = semesterSummary;
  const sameColumns = results.filter((result) => JSON.stringify(result.columns) === JSON.stringify(primary.columns));
  const seenRows = new Set();
  const rows = sameColumns.flatMap((result) => result.rows).filter((row) => {
    const key = JSON.stringify(row);
    if (seenRows.has(key)) return false;
    seenRows.add(key);
    return true;
  });
  if (rows.length > HOME_MAX_ROWS) throw new Error(words(ctx, "查询结果过多，请缩小范围后再试。",
    "查詢結果過多，請縮小範圍後再試。", "Too many results. Narrow your query."));
  if (!captured) {
    const after = await currentAccount(ctx);
    if (!after) return { loggedIn: false };
    if (after.id !== account.id) throw new Error(words(ctx,
      "查询期间账号发生了变化，本次没有保存，请重新检查登录。", "查詢期間帳號發生變化，本次未儲存，請重新檢查登入。",
      "The account changed during the query. Nothing was saved. Check your login again."));
  }
  const summary = [{
    label: words(ctx, "查询记录", "查詢記錄", "Records"),
    value: String(rows.length),
  }, ...(primary.summary || [])].slice(0, 16);
  const message = captured ? words(ctx,
    "已保存当前教务页面的查询结果，范围以页面所选条件为准。",
    "已儲存目前教務頁面的查詢結果，範圍以頁面所選條件為準。",
    "Saved the current academic page results. The scope follows the filters selected on that page.") : "";
  return { loggedIn: true, account, section: {
    id, columns: primary.columns, rows, summary, message,
    // The per-semester GPA table sits above the course list; it used to be parsed and then dropped here.
    semesterSummary: primary.semesterSummary || null,
  } };
}
