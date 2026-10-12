const ATRUST_ENTRY_URL = "https://atrust.yangtzeu.edu.cn:4443/";
const COURSE_HOME_URL = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/courseTableForStd.action";
const COURSE_DETAIL_URL = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/courseTableForStd!courseTable.action?sf_request_type=ajax";
const SEMESTER_QUERY_URL = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/dataQuery.action";
const COURSE_HOST = "jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
const COURSE_DIRECT_HOST = "jwc3.yangtzeu.edu.cn";
const COURSE_HOME_PATH = "/eams/courseTableForStd.action";
const COURSE_TABLE_PATH = "/eams/courseTableForStd!courseTable.action";
const COURSE_HOME_CAPTURE_ID = "course-home-html";
const COURSE_DETAIL_CAPTURE_ID = "course-detail-html";
const WEBVIEW_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const SEMESTER_PROBE_LIMIT = 4;
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
  const courseMeta = await resolveCourseMeta(ctx, extractMeta(courseHomeHtml));
  const detailHtmlParts = await readCapturedCourseDetailHtml(ctx, courseMeta.semesterId);

  // 周次下拉框里有「全部」时先按全部周取一次：每门课都带着自己的上课周次（validWeeks），
  // 一次就能拿全。没有这个选项、或取不到课时，退回逐周请求——那要发二十来个请求，
  // 还常被教务的「请不要过快点击」限流
  const allWeeks = courseMeta.hasAllWeeksOption
    ? await requestCourseDetail(ctx, courseMeta, "").catch(() => null)
    : null;
  const { results: weekResults } = allWeeks && allWeeks.status === "ready" && countActivities(allWeeks.html) > 0
    ? { results: [allWeeks] }
    : await fetchSampledWeeksParallel(ctx, courseMeta, DETAIL_CONCURRENCY);
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

/**
 * 课表首页加载完后，页面会把地址换成 courseTableForStd!courseTable.action
 * （WebView 只报告换过之后的地址），两个都要认，否则 run 一直停在等待首页。
 */
function isCourseHomePage(value) {
  const s = String(value || "").toLowerCase();
  return isCourseHostUrl(s) &&
    (s.includes(COURSE_HOME_PATH.toLowerCase()) || s.includes(COURSE_TABLE_PATH.toLowerCase()));
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

/**
 * 教务系统有时把上一个学期当成当前学期返回，页面上的 semester.id 因此不可尽信。
 * 这里列出全部学期，从最新的往回试，取第一个真的排了课的学期；
 * 学期列表取不到或都试不出课时，退回页面自己给的那个学期。
 */
async function resolveCourseMeta(ctx, meta) {
  const candidates = await semesterCandidates(ctx, meta);
  for (const candidate of candidates.slice(0, SEMESTER_PROBE_LIMIT)) {
    if (candidate === meta.semesterId) {
      return meta;
    }
    const probe = await probeSemester(ctx, meta, candidate);
    if (probe) {
      return { ...meta, semesterId: candidate, maxWeek: probe.maxWeek || meta.maxWeek };
    }
  }
  return meta;
}

/** 返回按学年学期从新到旧排列的学期 id，页面当前学期始终作为兜底排在最后。 */
async function semesterCandidates(ctx, meta) {
  const listed = await fetchSemesterList(ctx, meta);
  const ordered = listed
    .slice()
    .sort((a, b) => compareSemesterDesc(a, b))
    .map((item) => item.id);
  const result = [];
  for (const id of ordered.concat([meta.semesterId])) {
    if (id && !result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}

/** 学年靠后的更新；同一学年内学期序号大的更新。 */
function compareSemesterDesc(a, b) {
  if (a.year !== b.year) {
    return b.year - a.year;
  }
  return b.term - a.term;
}

async function fetchSemesterList(ctx, meta) {
  const body = new URLSearchParams({
    tagId: "semesterBar",
    dataType: "semesterCalendar",
    value: String(meta.semesterId),
    empty: "false",
  }).toString();

  const raw = await requestTextInPage(ctx, {
    url: `${SEMESTER_QUERY_URL}?sf_request_type=ajax`,
    method: "POST",
    headers: {
      ...AJAX_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: `https://${COURSE_HOST}`,
      Referer: COURSE_HOME_URL,
    },
    body,
  }).catch(() => "");

  return parseSemesterList(raw);
}

/**
 * 学期列表接口返回的是 JS 对象字面量而非严格 JSON，键与值都可能不带引号，
 * 因此按条目逐个取字段而不是整体解析。
 */
function parseSemesterList(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }
  const items = [];
  for (const match of raw.matchAll(/\{[^{}]*\bid\s*:\s*"?(\d+)"?[^{}]*\}/g)) {
    const entry = match[0];
    const id = match[1];
    const schoolYear = firstGroupOrNull(entry, /schoolYear\s*:\s*"?(\d{4})/);
    const name = firstGroupOrNull(entry, /name\s*:\s*"?([^",}]+)/);
    if (!schoolYear) {
      continue;
    }
    items.push({
      id,
      year: Number(schoolYear),
      term: Number(String(name || "").replace(/[^\d]/g, "")) || 0,
    });
  }
  return items;
}

/** 取该学期第一周的课表，排了课才认为这个学期可用。 */
async function probeSemester(ctx, meta, semesterId) {
  const detail = await requestCourseDetail(ctx, { ...meta, semesterId }, 1)
    .catch(() => null);
  if (!detail || detail.status !== "ready" || countActivities(detail.html) === 0) {
    return null;
  }
  const maxWeek = Number(firstGroupOrNull(detail.html, /var maxWeek = (\d+);/)) || 0;
  return { maxWeek };
}

function countActivities(html) {
  let count = 0;
  for (const _ of String(html).matchAll(/activity = new TaskActivity\(/g)) {
    count += 1;
  }
  return count;
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

/**
 * 抓到的课表响应可能来自别的学期，请求体里带着当时用的 semester.id，
 * 与本次学期对不上的直接丢掉，免得两个学期的课混在一起。
 */
async function readCapturedCourseDetailHtml(ctx, semesterId) {
  const packets = await readCapturedPackets(ctx, COURSE_DETAIL_CAPTURE_ID);
  const readyHtml = [];
  const seen = new Set();
  for (const packet of packets) {
    if (!matchesSemester(packetRequestBody(packet), semesterId)) {
      continue;
    }
    const text = packetResponseBody(packet);
    if (typeof text !== "string" || text.trim().length === 0) {
      continue;
    }
    const classified = classifyCourseDetailResponse(text, "packet", null);
    if (classified.status !== "ready" || seen.has(classified.html)) {
      continue;
    }
    seen.add(classified.html);
    readyHtml.push(classified.html);
  }
  return readyHtml;
}

/** 请求体里读不出 semester.id 时不作判断，保留原有的抓包兜底。 */
function matchesSemester(requestBody, semesterId) {
  const captured = firstGroupOrNull(String(requestBody || ""), /semester\.id=(\d+)/);
  return !captured || captured === String(semesterId);
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

async function readCapturedPackets(ctx, captureId) {
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
  return packets.filter((packet) => packet && typeof packet === "object");
}

function packetRequestBody(packet) {
  const candidates = [
    packet.requestBody,
    packet.request?.body,
    packet.request?.bodyText,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
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
    // 课程详情里逐条列出；不认识这个字段的旧版 App 会直接忽略
    details: course.details || [],
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
    hasAllWeeksOption: hasAllWeeksOption(html),
  };
}

/**
 * 周次下拉框里有没有值为空的「全部」选项。有它才说明 startWeek 传空就是整学期；
 * 没有的话传空的含义说不准（可能只回某一周），宁可逐周请求也不冒丢课的险。
 */
function hasAllWeeksOption(html) {
  const firstWeek = html.search(/<option value="\d+">第\d+周<\/option>/);
  if (firstWeek < 0) {
    return false;
  }
  const selectStart = html.lastIndexOf("<select", firstWeek);
  const selectEnd = html.indexOf("</select>", firstWeek);
  if (selectStart < 0 || selectEnd < 0) {
    return false;
  }
  return /<option value=""/.test(html.slice(selectStart, selectEnd));
}

function buildSchedule(input) {
  const meta = input.meta;
  const detailHtml = input.detailHtml || "";
  if (!meta) {
    throw new Error("未找到 EAMS 元数据");
  }
  const unitCount = Number(firstGroupOrNull(detailHtml, /var unitCount = (\d+);/)) || 8;
  const teacherMap = parseTeacherMap(detailHtml);
  const lessonInfo = parseLessonTable(detailHtml);
  const activities = parseActivities(detailHtml, unitCount, meta.maxWeek, teacherMap, lessonInfo);
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

/**
 * 课表下面那张课程列表：序号 | 课程代码 | 课程名称 | 学分 | 课程序号 | 教师 | 备注 | 操作。
 *
 * 按表头文字认列而不是按位置，教务调了列序也不会张冠李戴；认不出表头时返回空，
 * 课程详情里就只剩课程序号，不影响导课本身。返回「课程序号 → 附加信息」。
 */
function parseLessonTable(detailHtml) {
  const result = {};
  let columns = null;
  for (const row of String(detailHtml).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi)) {
      cells.push(cell[2]);
    }
    const texts = cells.map(cellText);
    if (!columns) {
      const code = texts.indexOf("课程代码");
      const sequence = texts.indexOf("课程序号");
      if (code >= 0 && sequence >= 0) {
        columns = { code, sequence, credit: texts.indexOf("学分"), remark: texts.indexOf("备注") };
      }
      continue;
    }
    const sequence = texts[columns.sequence];
    if (!/^\d+$/.test(sequence || "")) {
      continue;
    }
    const pick = (index) => (index >= 0 ? texts[index] || "" : "");
    result[sequence] = [
      { label: "课程代码", value: pick(columns.code) },
      { label: "学分", value: pick(columns.credit) },
      { label: "备注", value: pick(columns.remark) },
    ].filter((field) => field.value.length > 0);
  }
  return result;
}

function cellText(html) {
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function parseActivities(detailHtml, unitCount, maxWeek, teacherMap, lessonInfo = {}) {
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
    const courseSequence = extractSequence(rawCourseLabel) || extractSequence(taskToken);
    const sequence = courseSequence || `activity-${position}`;
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
      details: courseSequence
        ? [{ label: "课程序号", value: courseSequence }, ...(lessonInfo[courseSequence] || [])]
        : [],
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
