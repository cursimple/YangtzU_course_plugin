import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(process.env.JSDOM_HOME ? join(process.env.JSDOM_HOME, "package.json") : new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
globalThis.DOMParser = new JSDOM("").window.DOMParser;
const source = await readFile(new URL("../plugin-packages/yangtzeu-eams/ui/home.js", import.meta.url), "utf8");
const home = await import("data:text/javascript;base64," + Buffer.from(source + "\nexport { parseHomeAccount, parseSectionPage, queryLinks, menuEntry };").toString("base64"));
const header = "<div>我的账户 返回首页 退出 测试同学(2099000001)学生</div>";
const gradeTable = `<table><tr><th>序号</th><th>课程名称</th><th>总评成绩</th><th>学分</th><th>绩点</th></tr>
  <tr><td>1</td><td>数据库原理</td><td>88</td><td>3</td><td>3.8</td></tr>
  <tr><td>2</td><td>程序设计</td><td>优秀</td><td>2</td><td>4.0</td></tr></table>`;
const ctx = { settings: { language: "zh-CN" }, action: {} };
const origin = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";

test("account identity must come from a signed-in student header", () => {
  assert.deepEqual(home.parseHomeAccount(header), { id: "2099000001", number: "2099000001", name: "测试同学", school: "长江大学" });
  assert.equal(home.parseHomeAccount("<div>统一身份认证 用户名 密码 登录</div>"), null);
  assert.equal(home.parseHomeAccount("<div>我的账户 课程设计(2099123456) 教师</div>"), null);
});

test("grade HTML keeps scores, credits and grade points with the course name first", () => {
  const result = home.parseSectionPage(gradeTable, "grades", ctx);
  assert.deepEqual(result.columns, ["课程名称", "总评成绩", "学分", "绩点"]);
  assert.deepEqual(result.rows, [["数据库原理", "88", "3", "3.8"], ["程序设计", "优秀", "2", "4.0"]]);
});

test("grade HTML keeps the school semester summary above course rows", () => {
  const html = `<table><tr><th>学年度</th><th>学期</th><th>必修门数</th><th>必修总学分</th><th>必修平均绩点</th></tr>
    <tr><td>2024-2025</td><td>1</td><td>9</td><td>19</td><td>4.62</td></tr>
    <tr><td>2024-2025</td><td>2</td><td>8</td><td>22</td><td>4.53</td></tr>
    <tr><td>2025-2026</td><td>1</td><td>8</td><td>20.5</td><td>4.22</td></tr>
    <tr><td>在校汇总</td><td></td><td>34</td><td>84</td><td>4.29</td></tr></table>${gradeTable}`;
  const result = home.parseSectionPage(html, "grades", ctx);
  assert.deepEqual(result.semesterSummary.rows[0], ["2024-2025", "1", "9", "19", "4.62"]);
  assert.deepEqual(result.semesterSummary.rows.at(-1), ["在校汇总", "", "34", "84", "4.29"]);
});

test("hidden semesters do not enter the current result", () => {
  const html = `<section hidden>${gradeTable.replace("数据库原理", "旧学期课程")}</section>${gradeTable}`;
  assert.equal(home.parseSectionPage(html, "grades", ctx).rows.length, 2);
});

test("curriculum and credit progress use the values reported by the school", () => {
  const plan = "<table><tr><th>课程名称</th><th>课程性质</th><th>计划学分</th></tr><tr><td>高等数学</td><td>必修</td><td>5</td></tr></table>";
  assert.deepEqual(home.parseSectionPage(plan, "plan", ctx).rows, [["高等数学", "必修", "5"]]);
  const progress = "<table><tr><th>课程类别</th><th>要求学分</th><th>已获得学分</th></tr><tr><td>专业必修</td><td>40</td><td>24</td></tr></table>";
  assert.deepEqual(home.parseSectionPage(progress, "credits", ctx).rows, [["专业必修", "40", "24"]]);
});

test("student details are parsed as labeled records", () => {
  const html = "<table><tr><td>学号：</td><td>2099000001</td><td>姓名：</td><td>测试同学</td></tr><tr><td>专业：</td><td>软件工程</td><td>预计毕业时间：</td><td>2028年6月</td></tr></table>";
  assert.deepEqual(home.parseSectionPage(html, "overview", ctx).rows, [
    ["学号", "2099000001"], ["姓名", "测试同学"], ["专业", "软件工程"], ["预计毕业时间", "2028年6月"],
  ]);
});

test("exam menu entries and exam tables are exposed as their own section", () => {
  const entry = home.menuEntry('<a href="/eams/exam/studentExam.action">我的考试</a>', /我的考试|考试安排/);
  assert.equal(entry.url, origin + "/eams/exam/studentExam.action");
  const result = home.parseSectionPage("<table><tr><th>考试课程</th><th>考试时间</th><th>考试地点</th><th>座号</th></tr><tr><td>高等数学</td><td>2026-12-20 09:00</td><td>东一教 101</td><td>12</td></tr></table>", "exams", ctx);
  assert.deepEqual(result.columns, ["考试课程", "考试时间", "考试地点", "座号"]);
  assert.deepEqual(result.rows, [["高等数学", "2026-12-20 09:00", "东一教 101", "12"]]);
});

test("JSON grade responses and nested pagination are validated", () => {
  const record = { courseName: "算法设计", score: "90", credits: 3, gp: 4 };
  assert.equal(home.parseSectionPage(JSON.stringify({ data: { rows: [record], total: 1 } }), "grades", ctx).rows[0][1], "90");
  assert.throws(() => home.parseSectionPage(JSON.stringify({ data: { rows: [record], total: 20 } }), "grades", ctx), /分页/);
  assert.throws(() => home.parseSectionPage('{"success":false,"data":[]}', "grades", ctx), /未能完成/);
  assert.throws(() => home.parseSectionPage('{"code":403,"data":[]}', "grades", ctx), /未能完成/);
});

test("a login page or unknown layout is not saved as an empty grade result", () => {
  assert.equal(home.parseSectionPage("<h1>登录</h1><input type=password>", "grades", ctx), null);
  assert.equal(home.parseSectionPage("<p>课程查询系统</p>", "grades", ctx), null);
  assert.deepEqual(home.parseSectionPage("<p>暂无成绩记录</p>", "grades", ctx).rows, []);
});

test("an unhydrated AJAX table is not cached as zero courses", () => {
  const shell = "<table><tr><th>课程名称</th><th>成绩</th><th>学分</th></tr></table>";
  assert.equal(home.parseSectionPage(shell, "grades", ctx), null);
  assert.deepEqual(home.parseSectionPage(shell.replace("</table>", '<tr><td colspan=3>暂无成绩记录</td></tr></table>'), "grades", ctx).rows, []);
});

test("query discovery excludes external sites and modification endpoints", () => {
  const html = `<a href="/eams/teach/grade/course/person!search.action">查询成绩</a>
    <a href="https://example.org/eams/grade.action">外部</a>
    <form action="/eams/grade!save.action"><input name=score value=100></form>
    <form action="/eams/grade!deleteAll.action"></form>
    <form action="/eams/grade/saveDraft.action"></form>
    <a href="/eams/teach/grade/transcript/report.action">导出成绩</a>
    <form action="/eams/grade!search.action" method=post><select name=semester><option value="">全部</option><option value=1 selected>本学期</option></select></form>`;
  const links = home.queryLinks(html, origin + "/eams/home.action", "grades");
  assert.equal(links.length, 2);
  assert.equal(links[1].body, "semester=");
  assert.ok(links.every((link) => link.url.startsWith(origin) && !link.url.includes("!save")));
});

test("the real EAMS landing-page pattern prefers complete history over reports and semester shortcuts", () => {
  const html = `<form action="/eams/teach/grade/course/person.action" method="post"><input name="projectType" value=""></form>
    <script>
    var historyUrl = "/eams/teach/grade/course/person!historyCourseGrade.action?projectType=" + projectType;
    var transcript = "/eams/teach/grade/transcript/report.action";
    var semester = "/eams/teach/grade/course/person!search.action?semesterId=409&projectType=" + projectType;
    </script>`;
  const links = home.queryLinks(html, origin + "/eams/teach/grade/course/person.action", "grades");
  assert.equal(links.length, 1);
  assert.equal(new URL(links[0].url).pathname, "/eams/teach/grade/course/person!historyCourseGrade.action");
});

test("the gateway URL shim cannot send discovered queries back to the internal network", () => {
  const NativeURL = globalThis.URL;
  globalThis.URL = class GatewayURL extends NativeURL {
    constructor(value, base) {
      super(value, base);
      if (this.hostname === "jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn") this.hostname = "jwc3.yangtzeu.edu.cn";
    }
  };
  try {
    const grades = home.queryLinks(`<script>
      var history = "/eams/teach/grade/course/person!historyCourseGrade.action?projectType=" + projectType;
      </script><a href="https://attacker.example/eams/grade.action">External</a>`,
      origin + "/eams/teach/grade/course/person.action", "grades");
    assert.equal(grades.length, 1);
    assert.ok(grades[0].url.startsWith(origin + "/eams/"));
    const plan = home.queryLinks('<form action="/eams/myPlanByMajor.action"><input name="pageNo" value="2"></form>',
      origin + "/eams/home.action", "plan");
    assert.equal(plan.length, 1);
    assert.equal(plan[0].url, origin + "/eams/myPlanByMajor.action?pageNo=2");
  } finally { globalThis.URL = NativeURL; }
});

test("the loaded academic entry avoids a duplicate home request but the final account check is fresh", async () => {
  const window = new JSDOM(header, { url: origin + "/eams/home.action" }).window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  let homeReads = 0;
  try {
    const result = await home.sync({
      ...ctx, action: { sectionId: "grades" }, network: { async fetch(url) {
        return { ok: true, async text() {
          if (url.endsWith("/home.action")) { homeReads++; return header; }
          return gradeTable;
        } };
      } },
    });
    assert.equal(result.section.rows.length, 2);
    assert.equal(homeReads, 1);
    await assert.rejects(home.sync({
      ...ctx, action: { sectionId: "grades" }, network: { async fetch(url) {
        return { ok: true, async text() {
          return url.endsWith("/home.action") ? header.replace("2099000001", "2099000002") : gradeTable;
        } };
      } },
    }), /账号发生了变化/);
  } finally {
    delete globalThis.document;
    delete globalThis.location;
    window.close();
  }
});

test("the grade page's all-semesters link supplies the semester GPA table", async () => {
  const summary = `<table><tr><th>学年度</th><th>学期</th><th>必修门数</th><th>必修总学分</th><th>必修平均绩点</th></tr>
    <tr><td>2024-2025</td><td>1</td><td>9</td><td>19</td><td>4.62</td></tr>
    <tr><td>在校汇总</td><td></td><td>9</td><td>19</td><td>4.62</td></tr></table>`;
  const grades = `<a href="/eams/teach/grade/std/list.action">查看所有学期</a>${gradeTable}`;
  const fetches = [];
  const result = await home.sync({
    ...ctx, action: { sectionId: "grades" }, network: { async fetch(url) {
      fetches.push(url);
      return { ok: true, async text() {
        if (url.endsWith("/home.action")) return header;
        if (url.includes("std/list")) return summary;
        return grades;
      } };
    } },
  });
  assert.ok(fetches.some((url) => url.includes("std/list")), "the summary page is fetched");
  assert.deepEqual(result.section.semesterSummary.rows[0], ["2024-2025", "1", "9", "19", "4.62"]);
});

test("a throttle response is retried rather than reported as an expired login", async () => {
  let reads = 0;
  const result = await home.checkLogin({
    ...ctx, network: { async fetch() {
      return { ok: true, async text() { return ++reads === 1 ? "<p>请不要过快点击 []</p>" : header; } };
    } },
  });
  assert.equal(result.loggedIn, true);
  assert.equal(reads, 2);
});

test("persistent throttling stops after bounded retries and preserves the previous result", async () => {
  let reads = 0;
  await assert.rejects(home.checkLogin({
    ...ctx, network: { async fetch() {
      reads++;
      return { ok: true, async text() { return "<p>请不要过快点击 []</p>"; } };
    } },
  }), /上次结果已保留/);
  assert.equal(reads, 3);
});

test("rendered-page capture is offline and keeps its own account identity", async () => {
  const result = await home.sync({
    ...ctx, action: { sectionId: "grades", pageHtml: header + gradeTable },
    network: { fetch() { throw new Error("Must not make an offline query"); } },
  });
  assert.equal(result.account.id, "2099000001");
  assert.equal(result.section.rows.length, 2);
});

test("online query follows read-only result pages and checks the account again", async () => {
  const calls = [];
  const result = await home.sync({
    ...ctx, action: { sectionId: "grades" },
    network: { async fetch(url, options) {
      calls.push(url);
      if (url.endsWith("/home.action")) {
        assert.equal(options.cache, "no-store");
        assert.equal(options.headers["X-Requested-With"], undefined);
      }
      return { ok: true, async text() {
        if (url.endsWith("/home.action")) return header;
        if (url.includes("!history")) return gradeTable;
        return '<a href="/eams/teach/grade/course/person!historyCourseGradeTable.action">全部成绩</a>';
      } };
    } },
  });
  assert.equal(result.section.rows.length, 2);
  assert.equal(calls.filter((url) => url.endsWith("/home.action")).length, 2);
});

test("an account switch during refresh rejects the result", async () => {
  let checks = 0;
  await assert.rejects(home.sync({
    ...ctx, action: { sectionId: "grades" },
    network: { async fetch(url) { return { ok: true, async text() {
      if (url.endsWith("/home.action")) return ++checks === 1 ? header : header.replace("2099000001", "2099000002");
      return gradeTable;
    } }; } },
  }), /账号发生了变化/);
});

test("a curriculum matrix collapses its term columns, drops numbering and lifts subtotals out", () => {
  const terms = [1, 2, 3, 4, 5, 6, 7, 8];
  const tick = (...marks) => terms.map((term) => `<td class="credit_hour">${marks.includes(term) ? " √ " : "&nbsp;"}</td>`).join("");
  const html = `<table>
    <tr><td rowspan="2">分类</td><td rowspan="2">课程代码</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="8">建议修读学期</td><td rowspan="2">是否必修</td></tr>
    <tr>${terms.map((term) => `<td><p>${term}</p></td>`).join("")}</tr>
    <tr><td class="group">必修</td><td>C001</td><td class="course">&nbsp;1&nbsp;高等数学</td><td>5</td>${tick(1)}<td>是</td></tr>
    <tr><td class="group">必修</td><td>C002</td><td class="course">&nbsp;2&nbsp;线性代数</td><td>3</td>${tick(2)}<td>是</td></tr>
    <tr><td class="group">选修</td><td>C003</td><td class="course">&nbsp;3&nbsp;人工智能导论</td><td>2</td>${tick(5, 6)}<td>否</td></tr>
    <tr><td class="group">必修</td><td colspan="2" class="summary">学分小计</td><td>8</td><td>5</td><td>3</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
    <tr><td colspan="3" class="summary">全程总计</td><td>10</td><td>5</td><td>3</td><td></td><td></td><td>2</td><td></td><td></td><td></td><td></td></tr>
    <tr><td colspan="3">备注</td><td colspan="10"></td></tr>
  </table>`;
  const result = home.parseSectionPage(html, "plan", ctx);
  assert.deepEqual(result.columns, ["课程名称", "分类", "课程代码", "学分", "建议修读学期", "是否必修"]);
  assert.deepEqual(result.rows, [
    ["高等数学", "必修", "C001", "5", "1", "是"],
    ["线性代数", "必修", "C002", "3", "2", "是"],
    ["人工智能导论", "选修", "C003", "2", "5、6", "否"],
  ]);
  assert.deepEqual(result.summary, [{ label: "必修学分小计", value: "8" }, { label: "全程总计", value: "10" }]);
});

test("a credit report keeps category rows as totals and only numbered rows as courses", () => {
  // Same shape as the school's credit report: a header table with totals, then category rows whose
  // numbering cell is text (spanning three columns), followed by numbered course rows.
  const html = `<table class="infoTable">
    <tr><td class="title">要求学分/实修学分:</td><td class="content">175 / 106.5</td><td class="title">GPA:</td><td class="content">4.3</td></tr></table>
    <table class="formTable">
    <tr><th>序号</th><th>课程代码</th><th>课程名称</th><th>要求学分</th><th>实修学分</th><th>成绩</th><th>是否必修课程</th><th>是否学位课程</th><th>是否通过</th><th>备注</th></tr>
    <tr><td colspan="3">一 必修(所有子项均应满足要求)</td><td>108</td><td>84</td><td></td><td></td><td></td><td>缺 24 学分 缺 29 门</td><td></td></tr>
    <tr><td>1</td><td>01141ZY022</td><td>计算机网络</td><td>4</td><td>4</td><td>92</td><td>是</td><td>是</td><td>是</td><td></td></tr>
    <tr><td>2</td><td>01141ZY018</td><td>汇编语言与微型计算机技术</td><td>4.5</td><td>0</td><td>--</td><td>是</td><td>否</td><td>否</td><td>在读</td></tr>
    </table>`;
  const result = home.parseSectionPage(html, "credits", ctx);
  assert.ok(!result.columns.includes("序号"));
  assert.deepEqual(result.rows.map((row) => row[0]), ["计算机网络", "汇编语言与微型计算机技术"]);
  assert.deepEqual(result.summary, [
    { label: "实修学分 / 要求学分", value: "106.5 / 175" },
    { label: "GPA", value: "4.3" },
    { label: "一 必修(所有子项均应满足要求)", value: "84 / 108" },
  ]);
});

test("a repeated header label without marks is left as the school reports it", () => {
  const html = "<table><tr><td>课程名称</td><td colspan=\"3\">学分</td></tr><tr><td>高等数学</td><td>1</td><td>2</td><td>3</td></tr></table>";
  const result = home.parseSectionPage(html, "plan", ctx);
  assert.equal(result.columns.length, 4);
});


const PROXY = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
const HOME_WITH_MENU = `<html><body><div>示例同学(2024000001) 学生 我的账户 退出</div>
  <a href="/eams/teach/grade/course/person.action">我的成绩</a>
  <a href="/eams/stdOtherGrade.action?projectId=1">校外成绩</a></body></html>`;

test("the external grades address is read from the academic menu", () => {
  assert.deepEqual(home.menuEntry(HOME_WITH_MENU, /校外成绩/), {
    url: PROXY + "/eams/stdOtherGrade.action?projectId=1",
    scope: "/eams/stdOtherGrade",
  });
  assert.equal(home.menuEntry("<a href='https://elsewhere.example/eams/x.action'>校外成绩</a>", /校外成绩/), null);
  assert.equal(home.menuEntry("<a href='javascript:void(0)'>校外成绩</a>", /校外成绩/), null);
});

test("external grades follow only pages under the menu address", () => {
  const page = `<a href="/eams/stdOtherGrade!search.action?x=1">查询</a>
    <a href="/eams/teach/grade/course/person!historyCourseGrade.action">我的成绩</a>
    <a href="/eams/stdOtherGrade!remove.action">删除</a>`;
  const urls = home.queryLinks(page, PROXY + "/eams/stdOtherGrade.action", "external", "/eams/stdOtherGrade").map((p) => p.url);
  assert.deepEqual(urls, [PROXY + "/eams/stdOtherGrade!search.action?x=1"]);
});

test("syncing external grades opens the menu page and parses its grade table", async () => {
  const table = `<table><tr><th>课程名称</th><th>学年学期</th><th>学分</th><th>成绩</th></tr>
    <tr><td>大学英语（校外）</td><td>2025-2026 1</td><td>2</td><td>85</td></tr></table>`;
  const requested = [];
  const ctx = {
    settings: { language: "zh-CN" },
    action: { sectionId: "external" },
    network: { fetch: async (url) => {
      requested.push(url);
      const body = url.endsWith("/eams/home.action") ? HOME_WITH_MENU : table;
      return { ok: true, status: 200, text: async () => body };
    } },
  };
  const result = await home.sync(ctx);
  assert.equal(result.loggedIn, true);
  assert.deepEqual(result.section.rows, [["大学英语（校外）", "2025-2026 1", "2", "85"]]);
  assert.ok(requested.includes(PROXY + "/eams/stdOtherGrade.action?projectId=1"));
});

test("a menu without external grades says so instead of saving an empty result", async () => {
  const ctx = {
    settings: { language: "zh-CN" },
    action: { sectionId: "external" },
    network: { fetch: async () => ({ ok: true, status: 200, text: async () => "<div>示例同学(2024000001) 学生 我的账户 退出</div>" }) },
  };
  await assert.rejects(home.sync(ctx), /菜单里没有找到这一项/);
});

test("external grades read the home page again when the loaded document has no account", async () => {
  // The background run starts on the home address, but its document can be a shell without the account or menu.
  const window = new JSDOM("<html><body><div id='main'></div></body></html>", { url: PROXY + "/eams/home.action" }).window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  const table = `<table><tr><th>课程名称</th><th>学年学期</th><th>成绩</th></tr><tr><td>校外课程</td><td>2025-2026 1</td><td>88</td></tr></table>`;
  try {
    const result = await home.sync({
      settings: { language: "zh-CN" },
      action: { sectionId: "external" },
      network: { fetch: async (url) => ({ ok: true, status: 200, text: async () => (url.endsWith("/eams/home.action") ? HOME_WITH_MENU : table) }) },
    });
    assert.equal(result.loggedIn, true, "a shell document is not read as a lost login");
    assert.deepEqual(result.section.rows, [["校外课程", "2025-2026 1", "88"]]);
  } finally {
    delete globalThis.document;
    delete globalThis.location;
    window.close();
  }
});

test("external grades come from the qualification exam page, skipping its empty sign-up table", async () => {
  const menu = `<div>示例同学(2024000001) 学生 我的账户 退出</div>
    <a href="/eams/teach/grade/course/person.action">我的成绩</a><a href="/eams/stdOtherExamSignUp.action">校外考试</a>`;
  const page = `<div>资格考试报名记录</div><table><tr><th>报名科目</th><th>报名费</th><th>考纲费</th><th>材料费</th><th>报名时间</th><th>考试校区</th><th>缴费状态</th></tr></table>
    <div>资格考试成绩</div><table><tr><th>科目名称</th><th>成绩</th><th>是否通过</th><th>学年度(学期)</th></tr>
    <tr><td>英语四级</td><td>555</td><td>已通过</td><td>2024-2025学年1学期</td></tr>
    <tr><td>英语六级</td><td>540</td><td>已通过</td><td>2024-2025学年2学期</td></tr></table>`;
  const result = await home.sync({
    settings: { language: "zh-CN" }, action: { sectionId: "external" },
    network: { fetch: async (url) => ({ ok: true, status: 200, text: async () => (url.endsWith("/eams/home.action") ? menu : page) }) },
  });
  assert.deepEqual(result.section.columns, ["科目名称", "成绩", "是否通过", "学年度(学期)"]);
  assert.deepEqual(result.section.rows.map((r) => r[0] + " " + r[1]), ["英语四级 555", "英语六级 540"]);
});

test("external exams are discovered in the official dynamically loaded submenu", async () => {
  const landing = `<div>示例同学(2024000001) 学生 我的账户 退出</div>
    <script>bg.ready(function(){bg.Go('/eams/home!submenus.action?menu.id=','menu_panel','false')});</script>`;
  const submenu = `<a href="/eams/stdOtherExamSignUp.action">校外考试</a>`;
  const results = `<table><tr><th>科目名称</th><th>成绩</th><th>是否通过</th><th>学年度(学期)</th></tr>
    <tr><td>英语六级</td><td>540</td><td>已通过</td><td>2025-2026 1</td></tr></table>`;
  const requested = [];
  const result = await home.sync({
    settings: { language: "zh-CN" }, action: { sectionId: "external" },
    network: { fetch: async (url) => {
      requested.push(url);
      const body = url.endsWith("/eams/home.action") ? landing : url.includes("home!submenus.action") ? submenu : results;
      return { ok: true, status: 200, text: async () => body };
    } },
  });
  assert.equal(result.loggedIn, true);
  assert.deepEqual(result.section.rows, [["英语六级", "540", "已通过", "2025-2026 1"]]);
  assert.equal(requested.filter((url) => url.includes("home!submenus.action")).length, 1);
  assert.ok(requested.includes(PROXY + "/eams/stdOtherExamSignUp.action"));
});
