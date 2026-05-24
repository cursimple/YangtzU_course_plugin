const ATRUST_ENTRY_URL = "https://atrust.yangtzeu.edu.cn:4443/";
const ATRUST_HOST = "atrust.yangtzeu.edu.cn";
const COURSE_HOST = "jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
const DIRECT_COURSE_HOST = "jwc3.yangtzeu.edu.cn";
const COURSE_ORIGIN = `https://${COURSE_HOST}`;
const COURSE_HOME_PATH = "/eams/courseTableForStd.action";
const COURSE_DETAIL_PATH = "/eams/courseTableForStd!courseTable.action";
const COURSE_HOME_URL = `${COURSE_ORIGIN}${COURSE_HOME_PATH}`;
const COURSE_DETAIL_PAGE_URL = `${COURSE_ORIGIN}${COURSE_DETAIL_PATH}`;
const COURSE_DETAIL_AJAX_URL = `${COURSE_DETAIL_PAGE_URL}?sf_request_type=ajax`;
const COURSE_HOME_CAPTURE_ID = "course-home-html";
const COURSE_DETAIL_CAPTURE_ID = "course-detail-html";
const WEBVIEW_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const DETAIL_RETRY_LIMIT = 3;
const DETAIL_RETRY_DELAY_MS = 400;

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
  await applyUserAgent(ctx);

  const currentUrl = currentPageUrl();
  const courseProxyUrl = toCourseProxyUrl(currentUrl);
  if (courseProxyUrl) {
    ctx.web.open(courseProxyUrl);
    return {
      status: "opening-course-proxy",
      from: currentUrl,
      to: courseProxyUrl,
    };
  }

  if (isAuthenticationPage(currentUrl)) {
    return {
      status: "waiting-authentication",
      url: currentUrl,
    };
  }

  if (!isCourseDetailPage(currentUrl)) {
    ctx.web.open(COURSE_DETAIL_PAGE_URL);
    return {
      status: "opening-course-table",
      from: currentUrl,
      to: COURSE_DETAIL_PAGE_URL,
    };
  }

  const courseHome = await readCourseHome(ctx);
  if (courseHome.status !== "ready") {
    return handlePendingWebResponse(ctx, courseHome, currentUrl);
  }

  const courseHomeHtml = courseHome.html;
  const courseMeta = extractMeta(courseHomeHtml);
  let detailPayloadTemplate = await readCapturedCourseDetailRequestParams(ctx);
  const capturedDetail = await readCapturedCourseDetailHtml(ctx);
  if (!Array.isArray(capturedDetail)) {
    return handlePendingWebResponse(ctx, capturedDetail, currentUrl);
  }
  const detailHtmlParts = capturedDetail;

  for (let week = 1; week <= courseMeta.maxWeek; week += 1) {
    const detail = await requestCourseDetail(ctx, courseMeta, week, detailPayloadTemplate);
    if (detail.status !== "ready") {
      return handlePendingWebResponse(ctx, detail, currentUrl);
    }
    detailHtmlParts.push(detail.html);
    if (!detailPayloadTemplate) {
      detailPayloadTemplate = await readCapturedCourseDetailRequestParams(ctx);
    }
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

async function applyUserAgent(ctx) {
  if (typeof ctx?.web?.setUserAgent === "function") {
    await ctx.web.setUserAgent(WEBVIEW_USER_AGENT);
  }
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
  if (isAtrustLoginPage(value) || isAtrustVerifyPage(value)) {
    return true;
  }
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
  if (host === ATRUST_HOST && path.startsWith("/passport/")) {
    return true;
  }
  return false;
}

function isAtrustLoginPage(value) {
  const url = parseUrl(value);
  if (!url || url.hostname.toLowerCase() !== ATRUST_HOST) {
    return false;
  }
  const path = url.pathname.toLowerCase();
  const hash = url.hash.toLowerCase();
  const search = url.search.toLowerCase();
  if (!path.startsWith("/portal/")) {
    return false;
  }
  return path.includes("/shortcut") ||
    path.includes("/login") ||
    hash.includes("login") ||
    search.includes("login");
}

function isAtrustPortalPage(value) {
  const url = parseUrl(value);
  return !!url &&
    url.hostname.toLowerCase() === ATRUST_HOST &&
    url.pathname.toLowerCase().startsWith("/portal/");
}

function isAtrustVerifyPage(value) {
  const url = parseUrl(value);
  return !!url &&
    url.hostname.toLowerCase() === ATRUST_HOST &&
    url.pathname.toLowerCase().startsWith("/controller/v1/public/verify");
}

function isCourseDetailPage(value) {
  const url = parseUrl(toCourseProxyUrl(value) || value);
  return !!url &&
    url.hostname.toLowerCase() === COURSE_HOST &&
    url.pathname === COURSE_DETAIL_PATH;
}

function parseUrl(value, baseUrl = ATRUST_ENTRY_URL) {
  try {
    const url = new URL(value, baseUrl || ATRUST_ENTRY_URL);
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

function toCourseProxyUrl(value, baseUrl) {
  const url = parseUrl(value, baseUrl);
  if (!url) {
    return null;
  }
  if (
    url.hostname.toLowerCase() !== DIRECT_COURSE_HOST ||
    !url.pathname.toLowerCase().startsWith("/eams/")
  ) {
    return null;
  }
  url.protocol = "https:";
  url.hostname = COURSE_HOST;
  url.port = "";
  return url.href;
}

async function readCourseHome(ctx) {
  const captured = await readCapturedCourseHome(ctx);
  if (captured) {
    return captured;
  }

  const response = await requestTextInPage(ctx, {
    url: `${COURSE_HOME_URL}?_=${Date.now()}&sf_request_type=ajax`,
    method: "GET",
    headers: {
      ...AJAX_HEADERS,
    },
    referrer: COURSE_DETAIL_PAGE_URL,
  });
  return classifyCourseHomeResponse(response.text, "fetch", response.url);
}

async function requestCourseDetail(ctx, meta, week, payloadTemplate) {
  const body = buildCourseDetailBody(meta, week, payloadTemplate);

  for (let attempt = 1; attempt <= DETAIL_RETRY_LIMIT; attempt += 1) {
    const response = await requestTextInPage(ctx, {
      url: COURSE_DETAIL_AJAX_URL,
      method: "POST",
      headers: {
        ...AJAX_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      referrer: COURSE_DETAIL_PAGE_URL,
      body,
    });
    const detail = classifyCourseDetailResponse(response.text, `fetch-week-${week}`, week, response.url);

    if (detail.status !== "waiting-rate-limit" || attempt === DETAIL_RETRY_LIMIT) {
      return detail;
    }

    await delay(DETAIL_RETRY_DELAY_MS);
  }

  throw new Error(`第 ${week} 周课表请求未返回有效内容`);
}

function buildCourseDetailBody(meta, week, payloadTemplate) {
  const params = new URLSearchParams(payloadTemplate ? payloadTemplate.toString() : "");
  params.set("ignoreHead", "1");
  params.set("setting.kind", "std");
  params.set("startWeek", String(week));
  params.set("project.id", String(meta.projectId));
  params.set("semester.id", String(meta.semesterId));
  params.set("ids", String(meta.ids));
  return params.toString();
}

async function requestTextInPage(ctx, request) {
  const fetcher = typeof ctx?.network?.fetch === "function" ? ctx.network.fetch.bind(ctx.network) : fetch;
  const response = await fetcher(request.url, {
    method: request.method,
    credentials: "include",
    headers: request.headers,
    referrer: request.referrer || COURSE_DETAIL_PAGE_URL,
    body: request.body || undefined,
  });

  const responseText = await response.text();
  if (!response.ok) {
    if (isWebSessionTransitionHtml(responseText, response.url || request.url)) {
      return {
        text: responseText,
        url: response.url || request.url,
      };
    }
    throw new Error(`EAMS request failed: ${response.status} ${responseText.slice(0, 120)}`);
  }

  if (typeof responseText !== "string" || responseText.trim().length === 0) {
    throw new Error("EAMS 页面请求返回了空内容");
  }

  return {
    text: responseText,
    url: response.url || request.url,
  };
}

async function readCapturedCourseHome(ctx) {
  const responses = await readCapturedResponsePayloads(ctx, COURSE_HOME_CAPTURE_ID);
  for (let index = responses.length - 1; index >= 0; index -= 1) {
    const response = responses[index];
    const classified = classifyCourseHomeResponse(response.text, "packet", response.url);
    if (classified.status === "ready" || classified.status.startsWith("navigating-")) {
      return classified;
    }
  }
  return null;
}

async function readCapturedCourseDetailHtml(ctx) {
  const responses = await readCapturedResponsePayloads(ctx, COURSE_DETAIL_CAPTURE_ID);
  const readyHtml = [];
  const seen = new Set();
  for (const response of responses) {
    const classified = classifyCourseDetailResponse(response.text, "packet", null, response.url);
    if (classified.status.startsWith("navigating-")) {
      return classified;
    }
    if (classified.status !== "ready" || seen.has(classified.html)) {
      continue;
    }
    seen.add(classified.html);
    readyHtml.push(classified.html);
  }
  return readyHtml;
}

async function readCapturedCourseDetailRequestParams(ctx) {
  const packets = await readCapturedNetworkPackets(ctx, COURSE_DETAIL_CAPTURE_ID);
  for (let index = packets.length - 1; index >= 0; index -= 1) {
    const requestBody = packetRequestBody(packets[index]);
    if (typeof requestBody === "string" && requestBody.trim().length > 0) {
      return new URLSearchParams(requestBody);
    }
  }
  return null;
}

async function readCapturedResponsePayloads(ctx, captureId) {
  const packets = await readCapturedNetworkPackets(ctx, captureId);
  return packets
    .map(packetResponsePayload)
    .filter((value) => typeof value?.text === "string" && value.text.trim().length > 0);
}

async function readCapturedNetworkPackets(ctx, captureId) {
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
  return packets;
}

function packetResponsePayload(packet) {
  if (!packet || typeof packet !== "object") {
    return null;
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
      return {
        text: candidate,
        url: typeof packet.url === "string" ? packet.url : "",
      };
    }
  }
  return null;
}

function packetRequestBody(packet) {
  if (!packet || typeof packet !== "object") {
    return null;
  }
  const candidates = [
    packet.requestBody,
    packet.requestText,
    packet.request?.body,
    packet.request?.bodyText,
    packet.request?.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return null;
}

function classifyCourseHomeResponse(html, source, baseUrl) {
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
  }, baseUrl);
}

function classifyCourseDetailResponse(html, source, week, baseUrl) {
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
  }, baseUrl);
}

function classifyWebResponse(html, source, readyClassifier, baseUrl) {
  const value = typeof html === "string" ? html.trim() : "";
  if (value.length === 0) {
    return {
      status: "empty",
      source,
      reason: "响应内容为空",
    };
  }

  const atrustVerifyUrl = extractAtrustVerifyUrl(value, baseUrl);
  if (atrustVerifyUrl) {
    return {
      status: "navigating-atrust-verification",
      source,
      to: atrustVerifyUrl,
    };
  }

  if (isAtrustPortalPage(baseUrl) || looksLikeAtrustPortalHtml(value)) {
    return {
      status: "waiting-authentication",
      source,
      reason: "ATrust 仍在认证或门户跳转中，等待浏览器完成当前页面",
    };
  }

  const redirectUrl = extractWebRedirectUrl(value, baseUrl);
  if (redirectUrl) {
    return {
      status: "navigating-web-redirect",
      source,
      to: redirectUrl,
      reason: "页面返回了 HTML+JS 跳转脚本",
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
  if (state.status.startsWith("navigating-") && state.to && typeof ctx?.web?.open === "function") {
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

function isWebSessionTransitionHtml(html, baseUrl) {
  return !!extractAtrustVerifyUrl(html, baseUrl) ||
    isAtrustPortalPage(baseUrl) ||
    looksLikeAtrustPortalHtml(html) ||
    !!extractWebRedirectUrl(html, baseUrl) ||
    looksLikeAuthenticationHtml(html);
}

function extractAtrustVerifyUrl(html, baseUrl) {
  const raw = firstGroupOrNull(html, /locationUrl\s*=\s*(?:decodeURIComponent\(\s*)?["']([^"']+)["']\s*\)?/i);
  if (!raw) {
    return null;
  }
  const url = parseUrl(normalizeRedirectCandidate(raw), baseUrl);
  if (!url) {
    return null;
  }
  if (url.hostname.toLowerCase() !== ATRUST_HOST) {
    return null;
  }
  if (!url.pathname.toLowerCase().startsWith("/controller/v1/public/verify")) {
    return null;
  }
  return url.href;
}

function extractWebRedirectUrl(html, baseUrl) {
  const raw = extractRedirectCandidate(html);
  if (!raw) {
    return null;
  }
  const target = normalizeRedirectCandidate(raw);
  return toCourseProxyUrl(target, baseUrl) || parseUrl(target, baseUrl)?.href || null;
}

function extractRedirectCandidate(html) {
  const patterns = [
    /locationUrl\s*=\s*(?:decodeURIComponent\(\s*)?["']([^"']+)["']\s*\)?/i,
    /(?:window|top|self)\.location(?:\.href)?\s*=\s*(?:decodeURIComponent\(\s*)?["']([^"']+)["']\s*\)?/i,
    /(?:window|top|self)\.location\.(?:replace|assign)\(\s*(?:decodeURIComponent\(\s*)?["']([^"']+)["']\s*\)?\s*\)/i,
    /\blocation(?:\.href)?\s*=\s*(?:decodeURIComponent\(\s*)?["']([^"']+)["']\s*\)?/i,
    /\blocation\.(?:replace|assign)\(\s*(?:decodeURIComponent\(\s*)?["']([^"']+)["']\s*\)?\s*\)/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url\s*=\s*["']?([^"'<>\s]+)["']?/i,
  ];
  for (const pattern of patterns) {
    const raw = firstGroupOrNull(html, pattern);
    if (raw) {
      return raw;
    }
  }
  return null;
}

function normalizeRedirectCandidate(raw) {
  let value = decodeJsString(raw);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const decoded = safeDecodeURIComponent(value);
    if (decoded === value) {
      break;
    }
    value = decoded;
  }
  return value.trim();
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function looksLikeAuthenticationHtml(html) {
  const lower = html.toLowerCase();
  return lower.includes("authserver.yangtzeu.edu.cn") ||
    lower.includes("cas.yangtzeu.edu.cn") ||
    lower.includes("/portal/#/login") ||
    lower.includes("/portal/shortcut.html") ||
    lower.includes("/passport/") ||
    html.includes("统一身份认证") ||
    html.includes("用户登录") ||
    html.includes("扫码登录");
}

function looksLikeAtrustPortalHtml(html) {
  const lower = html.toLowerCase();
  return lower.includes("atrust.yangtzeu.edu.cn:4443/portal/") ||
    lower.includes("atrust.yangtzeu.edu.cn/portal/") ||
    lower.includes("/portal/#/login") ||
    lower.includes("/portal/#/page_app_handler") ||
    lower.includes("/portal/shortcut.html") ||
    lower.includes("shortcut_main.js");
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
