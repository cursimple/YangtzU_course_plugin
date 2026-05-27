const ATRUST_ENTRY_URL = "https://atrust.yangtzeu.edu.cn:4443/";
const COURSE_HOME_URL = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/courseTableForStd.action";
const COURSE_DETAIL_URL = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/courseTableForStd!courseTable.action?sf_request_type=ajax";
const COURSE_HOST = "jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
const COURSE_DIRECT_HOST = "jwc3.yangtzeu.edu.cn";
const COURSE_HOME_PATH = "/eams/courseTableForStd.action";
const COURSE_HOME_CAPTURE_ID = "course-home-html";
const COURSE_DETAIL_CAPTURE_ID = "course-detail-html";
const WEBVIEW_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const DETAIL_RETRY_LIMIT = 10;
const DETAIL_RETRY_DELAY_MS = 800;
const DETAIL_CONCURRENCY = 2;

const eamsSlotNodeByLabel = {
  "第一节": 1,
  "第二节": 2,
  "第三节": 4,
  "第四节": 5,
  "第五节": 7,
  "第六节": 8,
  "午间课": 3,
  "晚间课": 6,
};

const defaultSlotNodeByIndex = {
  0: 1,
  1: 2,
  2: 4,
  3: 5,
  4: 7,
  5: 8,
  6: 3,
  7: 6,
};

export async function run(ctx) {
  assertRuntime(ctx);

  const currentUrl = currentPageUrl();
  if (isAuthenticationPage(currentUrl)) {
    return {
      status: "waiting-authentication",
      url: currentUrl,
    };
  }

  if (isEamsHomePage(currentUrl)) {
    globalThis.location.href = COURSE_HOME_URL;
    return {
      status: "opening-course-home",
      from: currentUrl,
      to: COURSE_HOME_URL,
    };
  }

  if (!isCourseHomePage(currentUrl)) {
    return {
      status: "waiting-course-home-page",
      url: currentUrl,
    };
  }

  const courseHome = await readCourseHome(ctx);
  if (courseHome.status !== "ready") {
    return handlePendingWebResponse(ctx, courseHome, currentUrl);
  }

  const courseHomeHtml = courseHome.html;
  const courseMeta = extractMeta(courseHomeHtml);
  const detailHtmlParts = await readCapturedCourseDetailHtml(ctx);

  const { results: weekResults } = await fetchSampledWeeksParallel(ctx, courseMeta, DETAIL_CONCURRENCY);
  let pending = null;
  for (const detail of weekResults) {
    if (detail.status !== "ready") {
      if (!pending) pending = detail;
      continue;
    }
    detailHtmlParts.push(detail.html);
  }
  if (detailHtmlParts.length === 0 && pending) {
    return handlePendingWebResponse(ctx, pending, currentUrl);
  }

  const schedule = buildSchedule({
    meta: courseMeta,
    detailHtml: detailHtmlParts.join("\n"),
    termId: courseMeta.semesterId,
    updatedAt: new Date().toISOString(),
  });

  for (const dailySchedule of schedule.dailySchedules) {
    for (const course of dailySchedule.courses) {
      ctx.schedule.addCourse(toScheduleDraftCourse(course));
    }
  }

  return ctx.schedule.commit({ termId: schedule.termId });
}

function assertRuntime(ctx) {
  requireFunction(ctx?.web?.open, "ctx.web.open");
  requireFunction(ctx?.schedule?.addCourse, "ctx.schedule.addCourse");
  requireFunction(ctx?.schedule?.commit, "ctx.schedule.commit");
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`插件运行时缺少必要能力: ${name}`);
  }
}

function currentPageUrl() {
  return String(globalThis.location?.href || "");
}

function isAuthenticationPage(value) {
  const url = parseUrl(value);
  if (!url) {
    return true;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (
    host === "cas-yangtzeu-edu-cn.atrust.yangtzeu.edu.cn" ||
    host === "authserver.yangtzeu.edu.cn" ||
    host === "cas.yangtzeu.edu.cn" ||
    host === "ids.yangtzeu.edu.cn" ||
    host === "lp-open-weixin-qq-com.atrust.yangtzeu.edu.cn" ||
    host === "open-weixin-qq-com-s.atrust.yangtzeu.edu.cn" ||
    host === "res-wx-qq-com-s.atrust.yangtzeu.edu.cn"
  ) {
    return true;
  }
  if (host === "atrust.yangtzeu.edu.cn" && path.startsWith("/passport/")) {
    return true;
  }
  return false;
}

function isAtrustVerifyPage(value) {
  const url = parseUrl(value);
  return !!url &&
    url.hostname.toLowerCase() === "atrust.yangtzeu.edu.cn" &&
    url.pathname.toLowerCase().startsWith("/controller/v1/public/verify");
}

function isCourseHostUrl(value) {
  const s = String(value || "").toLowerCase();
  return s.includes("//" + COURSE_HOST + "/") ||
    s.includes("//" + COURSE_HOST + ":") ||
    s.includes("//" + COURSE_DIRECT_HOST + "/") ||
    s.includes("//" + COURSE_DIRECT_HOST + ":");
}

function isCourseHomePage(value) {
  const s = String(value || "").toLowerCase();
  return isCourseHostUrl(s) && s.includes(COURSE_HOME_PATH.toLowerCase());
}

function isEamsHomePage(value) {
  const s = String(value || "").toLowerCase();
  return isCourseHostUrl(s) && s.includes("/eams/home.action");
}

function parseUrl(value) {
  try {
    const url = new URL(value, ATRUST_ENTRY_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (!url.hostname) {
      return null;
    }
    return url;
  } catch (error) {
    return null;
  }
}

async function readCourseHome(ctx) {
  const dom = readDocumentHtml();
  if (dom.length > 0) {
    const classified = classifyCourseHomeResponse(dom, "dom");
    if (classified.status === "ready") {
      return classified;
    }
  }

  const captured = await readCapturedCourseHome(ctx);
  if (captured) {
    return captured;
  }

  const html = await requestTextInPage(ctx, {
    url: `${COURSE_HOME_URL}?_=${Date.now()}&sf_request_type=ajax`,
    method: "GET",
    headers: {
      ...AJAX_HEADERS,
      Referer: COURSE_HOME_URL,
    },
  });
  return classifyCourseHomeResponse(html, "fetch");
}

function readDocumentHtml() {
  try {
    const doc = globalThis.document;
    if (!doc || !doc.documentElement) return "";
    return String(doc.documentElement.outerHTML || "");
  } catch (e) {
    return "";
  }
}

async function fetchSampledWeeksParallel(ctx, meta, concurrency) {
  const weeks = Array.from({ length: meta.maxWeek }, (_, i) => i + 1);
  const results = new Array(weeks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < weeks.length) {
      const myIndex = cursor;
      cursor += 1;
      const week = weeks[myIndex];
      try {
        results[myIndex] = await requestCourseDetail(ctx, meta, week);
      } catch (e) {
        results[myIndex] = { status: "error", week, reason: e && e.message ? e.message : String(e) };
      }
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, weeks.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { weeks, results };
}

async function requestCourseDetail(ctx, meta, week) {
  const body = new URLSearchParams({
    ignoreHead: "1",
    "setting.kind": "std",
    startWeek: String(week),
    "project.id": String(meta.projectId),
    "semester.id": String(meta.semesterId),
    ids: String(meta.ids),
  }).toString();

  for (let attempt = 1; attempt <= DETAIL_RETRY_LIMIT; attempt += 1) {
    const html = await requestTextInPage(ctx, {
      url: COURSE_DETAIL_URL,
      method: "POST",
      headers: {
        ...AJAX_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn",
        Referer: COURSE_DETAIL_URL,
      },
      body,
    });
    const detail = classifyCourseDetailResponse(html, `fetch-week-${week}`, week);

    if (detail.status !== "waiting-rate-limit" || attempt === DETAIL_RETRY_LIMIT) {
      return detail;
    }

    await delay(DETAIL_RETRY_DELAY_MS);
  }

  throw new Error(`第 ${week} 周课表请求未返回有效内容`);
}

async function requestTextInPage(ctx, request) {
  const response = await fetch(request.url, {
    method: request.method,
    credentials: "include",
    headers: request.headers,
    body: request.body || undefined,
  });

  const responseText = await response.text();
  if (!response.ok) {
    if (isWebSessionTransitionHtml(responseText)) {
      return responseText;
    }
    throw new Error(`EAMS request failed: ${response.status} ${responseText.slice(0, 120)}`);
  }

  if (typeof responseText !== "string" || responseText.trim().length === 0) {
    throw new Error("EAMS 页面请求返回了空内容");
  }

  return responseText;
}

async function readCapturedCourseHome(ctx) {
  const responseTexts = await readCapturedResponseTexts(ctx, COURSE_HOME_CAPTURE_ID);
  for (let index = responseTexts.length - 1; index >= 0; index -= 1) {
    const classified = classifyCourseHomeResponse(responseTexts[index], "packet");
    if (classified.status === "ready") {
      return classified;
    }
  }
  return null;
}

async function readCapturedCourseDetailHtml(ctx) {
  const responseTexts = await readCapturedResponseTexts(ctx, COURSE_DETAIL_CAPTURE_ID);
  const readyHtml = [];
  const seen = new Set();
  for (const text of responseTexts) {
    const classified = classifyCourseDetailResponse(text, "packet", null);
    if (classified.status !== "ready" || seen.has(classified.html)) {
      continue;
    }
    seen.add(classified.html);
    readyHtml.push(classified.html);
  }
  return readyHtml;
}

async function readCapturedResponseTexts(ctx, captureId) {
  const web = ctx?.web;
  const packets = [];
  if (typeof web?.packets === "function") {
    const value = await web.packets(captureId);
    if (Array.isArray(value)) {
      packets.push(...value);
    }
  }
  if (typeof web?.packet === "function") {
    const value = await web.packet(captureId);
    if (value) {
      packets.push(value);
    }
  }
  return packets
    .map(packetResponseBody)
    .filter((value) => typeof value === "string" && value.trim().length > 0);
}

function packetResponseBody(packet) {
  if (!packet || typeof packet !== "object") {
    return "";
  }
  const candidates = [
    packet.responseBody,
    packet.responseText,
    packet.body,
    packet.text,
    packet.response?.body,
    packet.response?.bodyText,
    packet.response?.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
}

function classifyCourseHomeResponse(html, source) {
  return classifyWebResponse(html, source, (value) => {
    if (hasCourseHomeMeta(value)) {
      return {
        status: "ready",
        source,
        html: value,
      };
    }
    return {
      status: "waiting-course-home-data",
      source,
      reason: "课程首页尚未返回 EAMS 课表元数据",
    };
  });
}

function classifyCourseDetailResponse(html, source, week) {
  return classifyWebResponse(html, source, (value) => {
    if (value.includes("请不要过快点击")) {
      return {
        status: "waiting-rate-limit",
        source,
        week,
        retryAfterMs: DETAIL_RETRY_DELAY_MS,
      };
    }
    if (!looksLikeCourseDetailHtml(value)) {
      return {
        status: "waiting-course-detail-data",
        source,
        week,
        reason: "课程详情接口尚未返回 EAMS 课表数据",
      };
    }
    return {
      status: "ready",
      source,
      week,
      html: value,
    };
  });
}

function classifyWebResponse(html, source, readyClassifier) {
  const value = typeof html === "string" ? html.trim() : "";
  if (value.length === 0) {
    return {
      status: "empty",
      source,
      reason: "响应内容为空",
    };
  }

  const atrustVerifyUrl = extractAtrustVerifyUrl(value);
  if (atrustVerifyUrl) {
    return {
      status: "navigating-atrust-verification",
      source,
      to: atrustVerifyUrl,
    };
  }

  if (looksLikeAuthenticationHtml(value)) {
    return {
      status: "waiting-authentication",
      source,
      reason: "当前响应仍是统一认证页面",
    };
  }

  return readyClassifier(value);
}

function handlePendingWebResponse(ctx, state, currentUrl) {
  if (state.status === "navigating-atrust-verification" && state.to && typeof ctx?.web?.open === "function") {
    ctx.web.open(state.to);
  }
  return {
    status: state.status,
    source: state.source,
    url: currentUrl,
    to: state.to,
    week: state.week,
    retryAfterMs: state.retryAfterMs,
    reason: state.reason,
  };
}

function isWebSessionTransitionHtml(html) {
  return !!extractAtrustVerifyUrl(html) || looksLikeAuthenticationHtml(html);
}

function extractAtrustVerifyUrl(html) {
  const raw = firstGroupOrNull(html, /locationUrl\s*=\s*["']([^"']+)["']/);
  if (!raw) {
    return null;
  }
  const url = parseUrl(decodeJsString(raw));
  if (!url) {
    return null;
  }
  if (url.hostname.toLowerCase() !== "atrust.yangtzeu.edu.cn") {
    return null;
  }
  if (!url.pathname.toLowerCase().startsWith("/controller/v1/public/verify")) {
    return null;
  }
  return url.href;
}

function looksLikeAuthenticationHtml(html) {
  const lower = html.toLowerCase();
  return lower.includes("authserver.yangtzeu.edu.cn") ||
    lower.includes("cas.yangtzeu.edu.cn") ||
    lower.includes("/passport/") ||
    html.includes("统一身份认证") ||
    html.includes("用户登录") ||
    html.includes("扫码登录");
}

function hasCourseHomeMeta(html) {
  return /semesterCalendar\(\{/.test(html) &&
    /bg\.form\.addInput\(form,"ids","[^"]+"\)/.test(html) &&
    /<option value="\d+">第\d+周<\/option>/.test(html);
}

function looksLikeCourseDetailHtml(html) {
  return /var unitCount = \d+;/.test(html) ||
    /activity = new TaskActivity\(/.test(html) ||
    /table\d+\.activities\[index]/.test(html);
}

function toScheduleDraftCourse(course) {
  return {
    id: course.id,
    title: course.title,
    teacher: course.teacher,
    location: course.location,
    weeks: course.weeks,
    dayOfWeek: course.time.dayOfWeek,
    startNode: course.time.startNode,
    endNode: course.time.endNode,
    category: course.category,
  };
}

function extractMeta(html) {
  const weekValues = [];
  for (const match of html.matchAll(/<option value="(\d+)">第\d+周<\/option>/g)) {
    weekValues.push(Number(match[1]));
  }
  const maxWeek = Math.max(...weekValues);
  if (!Number.isFinite(maxWeek)) {
    throw new Error("未找到教学周上限");
  }
  return {
    semesterId: firstGroup(html, /semesterCalendar\(\{[^}]*value:"([^"]+)"/, "未找到 semester.id"),
    ids: firstGroup(html, /bg\.form\.addInput\(form,"ids","([^"]+)"\)/, "未找到学生 ids"),
    projectId: firstGroupOrNull(html, /project\.id=([^&']+)/) || "1",
    maxWeek,
  };
}

function buildSchedule(input) {
  const meta = input.meta;
  const detailHtml = input.detailHtml || "";
  if (!meta) {
    throw new Error("未找到 EAMS 元数据");
  }
  const unitCount = Number(firstGroupOrNull(detailHtml, /var unitCount = (\d+);/)) || 8;
  const teacherMap = parseTeacherMap(detailHtml);
  const activities = parseActivities(detailHtml, unitCount, meta.maxWeek, teacherMap);
  const grouped = {};
  for (const course of activities) {
    const day = String(course.time.dayOfWeek);
    grouped[day] = grouped[day] || [];
    grouped[day].push(course);
  }
  return {
    termId: input.termId || meta.semesterId,
    updatedAt: input.updatedAt,
    dailySchedules: Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b)
      .map((dayOfWeek) => ({
        dayOfWeek,
        courses: grouped[String(dayOfWeek)].sort(compareCourse),
      })),
  };
}

function parseTeacherMap(detailHtml) {
  const result = {};
  const rowPattern = /taskTable\.action\?lesson\.id=\d+".*?>(\d+)<\/a>\s*<\/td><td>([^<]*)<\/td>/gs;
  for (const match of detailHtml.matchAll(rowPattern)) {
    result[match[1]] = match[2].trim();
  }
  return result;
}

function parseActivities(detailHtml, unitCount, maxWeek, teacherMap) {
  const slotNodeMap = parseSlotNodeMap(detailHtml, unitCount);
  const blockPattern = /var teachers = \[(.*?)];.*?activity = new TaskActivity\((.*?)\);\s*((?:index\s*=\s*\d+\s*\*\s*unitCount\s*\+\s*\d+\s*;\s*table\d+\.activities\[index]\[table\d+\.activities\[index]\.length]=activity;\s*)+)/gs;
  const courses = [];
  let position = 0;
  for (const match of detailHtml.matchAll(blockPattern)) {
    const teacherBlock = match[1];
    const args = match[2];
    const indexBlock = match[3];
    const literals = [];
    for (const literal of args.matchAll(/"((?:\\.|[^"])*)"/g)) {
      literals.push(decodeJsString(literal[1]));
    }
    if (literals.length < 5) {
      throw new Error("TaskActivity 参数不足，无法解析课表");
    }
    const taskToken = literals[0];
    const rawCourseLabel = literals[1];
    const location = literals[3];
    const validWeeks = literals[4];
    const sequence = extractSequence(rawCourseLabel) || extractSequence(taskToken) || `activity-${position}`;
    const teacher = (firstGroupOrNull(teacherBlock, /name:"([^"]+)"/) || teacherMap[sequence] || "").trim();
    const indices = [];
    for (const indexMatch of indexBlock.matchAll(/index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)\s*;/g)) {
      indices.push({
        dayIndex: Number(indexMatch[1]),
        slotIndex: Number(indexMatch[2]),
      });
    }
    if (indices.length === 0) {
      throw new Error("未找到课表位置索引");
    }
    const dayOfWeek = indices[0].dayIndex + 1;
    const nodes = indices
      .map((entry) => resolveSlotNode(entry.slotIndex, unitCount, slotNodeMap))
      .sort((a, b) => a - b);
    const startNode = nodes[0];
    const endNode = nodes[nodes.length - 1];
    const title = normalizeCourseTitle(rawCourseLabel);
    courses.push({
      id: stableCourseId(sequence, dayOfWeek, startNode, endNode, title, teacher, location, validWeeks),
      title,
      teacher,
      location,
      weeks: parseWeeks(validWeeks, maxWeek),
      category: "course",
      time: {
        dayOfWeek,
        startNode,
        endNode,
      },
    });
    position += 1;
  }
  const seen = {};
  return courses.filter((course) => {
    if (seen[course.id]) {
      return false;
    }
    seen[course.id] = true;
    return true;
  });
}

function parseSlotNodeMap(detailHtml, unitCount) {
  const result = {};
  const rowPattern = /<tr\b[^>]*>(.*?)<\/tr>/gs;
  for (const match of detailHtml.matchAll(rowPattern)) {
    const rowHtml = match[1] || "";
    const labelMatch = /<td\b[^>]*>\s*(?:<font\b[^>]*>)?\s*([^<]+?)\s*(?:<\/font>)?\s*<\/td>/s.exec(rowHtml);
    if (!labelMatch) {
      continue;
    }
    const node = eamsSlotNodeByLabel[normalizeHtmlText(labelMatch[1])];
    if (!node) {
      continue;
    }
    const slotMatch = /id=["']TD(\d+)_\d+["']/.exec(rowHtml);
    if (!slotMatch) {
      continue;
    }
    result[Number(slotMatch[1]) % unitCount] = node;
  }
  return result;
}

function resolveSlotNode(slotIndex, unitCount, slotNodeMap) {
  if (slotNodeMap[slotIndex]) {
    return slotNodeMap[slotIndex];
  }
  if (unitCount === 8 && defaultSlotNodeByIndex[slotIndex]) {
    return defaultSlotNodeByIndex[slotIndex];
  }
  throw new Error(`未找到 EAMS 节次索引映射: unitCount=${unitCount}, slotIndex=${slotIndex}`);
}

function parseWeeks(validWeeks, maxWeek) {
  const weeks = [];
  for (let index = 1; index <= maxWeek && index < validWeeks.length; index += 1) {
    if (validWeeks.charAt(index) === "1") {
      weeks.push(index);
    }
  }
  return weeks;
}

function normalizeCourseTitle(rawCourseLabel) {
  return rawCourseLabel.replace(/\(\d+\)$/, "").trim();
}

function extractSequence(raw) {
  return firstGroupOrNull(raw, /\((\d+)\)$/);
}

function decodeJsString(value) {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\")
    .trim();
}

function normalizeHtmlText(value) {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function stableCourseId(sequence, dayOfWeek, startNode, endNode, title, teacher, location, validWeeks) {
  return `${sequence}-${dayOfWeek}-${startNode}-${endNode}-${hash32([title, teacher, location, validWeeks].join("|"))}`;
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compareCourse(left, right) {
  return left.time.startNode - right.time.startNode ||
    left.time.endNode - right.time.endNode ||
    left.title.localeCompare(right.title);
}

function firstGroup(value, regex, message) {
  const result = firstGroupOrNull(value, regex);
  if (!result) {
    throw new Error(message);
  }
  return result;
}

function firstGroupOrNull(value, regex) {
  const match = regex.exec(value);
  return match ? match[1] : null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
