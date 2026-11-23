import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(process.env.JSDOM_HOME ? join(process.env.JSDOM_HOME, "package.json") : new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const page = await readFile(new URL("../plugin-packages/yangtzeu-eams/ui/home.html", import.meta.url), "utf8");

// Same contract the host injects into the page head (PluginHomeScreen.kt, PLUGIN_PAGE_SHIM).
const shim = `(function () {
  var pending = {}, seq = 0, listeners = {};
  function parse(text) { return text ? JSON.parse(text) : null; }
  window.CurSimplePage = {
    call: function (method, args) {
      return new Promise(function (resolve, reject) {
        var id = "c" + (++seq);
        pending[id] = { resolve: resolve, reject: reject };
        try { CurSimplePageHost.call(id, method, JSON.stringify(args || {})); }
        catch (e) { delete pending[id]; reject({ code: "bridge_unavailable", detail: "" }); }
      });
    },
    on: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    __resolve: function (id, ok, text) {
      var p = pending[id]; if (!p) { return; } delete pending[id];
      var value = parse(text); if (ok) { p.resolve(value); } else { p.reject(value); }
    },
    __emit: function (name, text) {
      var value = parse(text);
      (listeners[name] || []).forEach(function (fn) { try { fn(value); } catch (e) {} });
    }
  };
})();`;

const ACCOUNT = { id: "a", name: "示例同学", number: "2099000001", school: "示例大学" };
const GRADES = {
  id: "grades",
  columns: ["课程名称", "总评成绩", "学分", "学年学期"],
  rows: [["数据库原理", "88", "3", "2025-2026-1"], ["程序设计", "95", "2", "2025-2026-2"]],
  summary: [{ label: "平均分", value: "91.5" }],
  message: "",
};
const SAVED = (section = GRADES) => JSON.stringify({
  activeAccountId: "a",
  accounts: { a: { account: ACCOUNT, verifiedAt: 1700000000000, sections: { grades: { savedAt: 1700000001000, section } } } },
});
const windows = [];
const RUN_ORIGIN = "https://system.example.edu";
/** Answers checkLogin with the account and every sync with that section. */
const everySection = (parsed) => parsed.mode === "checkLogin"
  ? { loggedIn: true, account: ACCOUNT }
  : { loggedIn: true, account: ACCOUNT, section: { ...GRADES, id: parsed.action.sectionId } };
afterEach(() => { windows.splice(0).forEach((window) => window.close()); });

/** A fake host. [run] answers page script calls; throw { __fail: {code, detail} } to report a failure. */
function open(options = {}) {
  const store = options.store || {};
  const calls = [];
  let refusals = options.refuseFirstCalls || 0;
  const html = options.delayedShim ? page : page.replace(/<head>/i, `<head><script>${shim}</script>`);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      if (options.delayedShim) window.setTimeout(() => window.eval(shim), 50);
      window.CurSimplePageHost = {
        call(id, method, args) {
          if (refusals > 0) { refusals--; throw new Error("bridge not attached yet"); }
          const parsed = JSON.parse(args);
          calls.push({ method, args: parsed });
          let ok = true;
          let value = {};
          try {
            switch (method) {
              case "init": value = { locale: "zh-CN", pluginName: "长江大学教务插件", theme: { primary: "#2e7d5b" }, credentialsSaved: options.credentialsSaved ?? true, runOrigin: RUN_ORIGIN }; break;
              case "saveLogin": value = { credentialsSaved: true }; break;
              case "probe": value = options.probe || { online: true, reachable: true }; break;
              case "storageGet": value = { value: store[parsed.key] ?? null }; break;
              case "storageSet":
                if (options.failStorage) throw { __fail: { code: "storage_full" } };
                store[parsed.key] = parsed.value; break;
              case "storageRemove": delete store[parsed.key]; break;
              case "run": value = options.run ? options.run(parsed) : { loggedIn: true, account: ACCOUNT, section: GRADES }; break;
              default: break;
            }
          } catch (failure) {
            ok = false;
            value = failure.__fail || { code: "failed", detail: String(failure.message || failure) };
          }
          Promise.resolve(value).then(
            (result) => setTimeout(() => window.CurSimplePage.__resolve(id, ok, JSON.stringify(result)), 0),
            (failure) => setTimeout(() => window.CurSimplePage.__resolve(id, false, JSON.stringify(failure.__fail || failure)), 0),
          );
        },
      };
    },
  });
  windows.push(dom.window);
  return { dom, win: dom.window, doc: dom.window.document, store, calls };
}

async function until(check, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for the page");
}
const text = (h) => h.doc.getElementById("app").textContent;
const callsTo = (dom, method) => dom.calls.filter((c) => c.method === method);

test("the page calls only the host commands the host answers", () => {
  const allowed = ["init", "run", "storageGet", "storageSet", "storageRemove", "clearCredentials", "openLogin", "closeLogin", "setLoginMessage", "saveLogin", "setLoginBusy", "probe", "navigateLogin"];
  const called = [...page.matchAll(/callPage\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 8, "page should call the host");
  for (const name of called) assert.ok(allowed.includes(name), `unknown host command: ${name}`);
});

test("the page makes no network requests of its own", () => {
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /XMLHttpRequest/);
  assert.doesNotMatch(page, /<(script|link|img|iframe|form)[^>]+(src|href|action)=["']?https?:/i);
});

test("the only academic address in the page is the sign-in address", () => {
  const urls = [...new Set([...page.matchAll(/https:\/\/[^"'\s)]+/g)].map((m) => m[0]))];
  assert.deepEqual(urls, ["https://atrust.yangtzeu.edu.cn:4443/"]);
});

test("every locale carries the same keys", async () => {
  const dom = open();
  await until(() => dom.calls.length > 0);
  const locales = dom.win.I18N;
  for (const name of ["zh-CN", "zh-TW", "en"]) assert.ok(locales[name], `locale ${name}`);
  const keys = (obj) => Object.keys(obj).sort();
  assert.deepEqual(keys(locales["zh-TW"].errors), keys(locales["zh-CN"].errors));
  assert.deepEqual(keys(locales.en.errors), keys(locales["zh-CN"].errors));
  assert.deepEqual(keys(locales.en.sections), keys(locales["zh-CN"].sections));
});

test("a stored account and its section are shown without any query", async () => {
  const dom = open({ store: { state: SAVED() } });
  await until(() => text(dom).includes("示例同学"));
  assert.match(text(dom), /示例大学/);
  assert.match(text(dom), /账号密码已加密保存/);
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  assert.match(text(dom), /平均分/);
  assert.match(text(dom), /91\.5/);
  assert.match(text(dom), /数据库原理/);
  assert.match(text(dom), /记录: 2/);
  assert.equal(callsTo(dom, "run").length, 0, "reading stored results runs no query");
});

test("the semester summary stacks one card per term instead of a sideways table", async () => {
  const saved = JSON.parse(SAVED());
  const gradesEntry = saved.accounts.a.sections.grades;
  const target = gradesEntry.section ? gradesEntry.section : gradesEntry;
  target.semesterSummary = {
    title: "学年学期汇总",
    columns: ["学年度", "学期", "必修门数", "必修总学分", "必修平均绩点"],
    rows: [
      ["2024-2025", "1", "9", "19", "4.62"],
      ["2024-2025", "2", "8", "22", "4.53"],
      ["在校汇总", "", "17", "41", "4.57"],
    ],
  };
  const dom = open({ store: { state: JSON.stringify(saved) } });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  assert.equal(dom.doc.querySelectorAll(".semester-summary-table").length, 0, "no horizontal table");
  assert.equal(dom.doc.querySelectorAll(".semester-item").length, 3);
  assert.match(text(dom), /第1學期|第1学期/);
  assert.match(text(dom), /4\.62/);
  assert.match(text(dom), /必修平均绩点/);
});

test("refreshing a section runs the sync and stores the new section", async () => {
  const dom = open({ store: { state: SAVED() } });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  dom.doc.querySelector('[data-act="refresh"]').click();
  await until(() => callsTo(dom, "storageSet").length > 0);
  const run = callsTo(dom, "run").at(-1);
  assert.equal(run.args.mode, "sync");
  assert.equal(run.args.action.sectionId, "grades");
  const saved = JSON.parse(dom.store.state);
  assert.equal(saved.accounts.a.sections.grades.section.rows.length, 2);
});

test("the search box narrows the rows and keeps its focus", async () => {
  const dom = open({ store: { state: SAVED() } });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  const input = dom.doc.querySelector('[data-act="query"]');
  input.value = "程序";
  input.dispatchEvent(new dom.win.Event("input", { bubbles: true }));
  assert.equal(dom.doc.querySelector('[data-act="query"]'), input, "the same input stays in place");
  assert.match(text(dom), /程序设计/);
  assert.doesNotMatch(text(dom), /数据库原理/);
});

test("sign-in asks the host for the sign-in sheet with its own buttons", async () => {
  const dom = open({ store: { state: SAVED() } });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  dom.doc.querySelector('[data-act="signin"]').click();
  await until(() => callsTo(dom, "openLogin").length > 0);
  const request = callsTo(dom, "openLogin").at(-1).args;
  assert.equal(request.url, "https://atrust.yangtzeu.edu.cn:4443/");
  assert.deepEqual(request.actions.map((a) => a.id), ["check", "save"]);
  assert.equal(request.actions.find((a) => a.id === "save").capture, true);
  assert.equal(request.autoSubmit, false, "the user must press the portal's sign-in button");
});

test("saving the page from the sheet runs the sync with the captured page, then closes the sheet", async () => {
  const dom = open({ store: { state: SAVED() } });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  dom.doc.querySelector('[data-act="signin"]').click();
  await until(() => callsTo(dom, "openLogin").length > 0);
  dom.win.CurSimplePage.__emit("loginAction", JSON.stringify({ id: "save", captured: true }));
  await until(() => callsTo(dom, "closeLogin").length > 0);
  const run = callsTo(dom, "run").at(-1);
  assert.equal(run.args.action.pageFromLogin, true);
  assert.equal(run.args.action.sectionId, "grades");
});

test("a sign-in check that fails keeps the sheet open and says why", async () => {
  const dom = open({ credentialsSaved: false, run: () => ({ loggedIn: false }) });
  await until(() => text(dom).includes("未登录"));
  dom.win.CurSimplePage.__emit("loginAction", JSON.stringify({ id: "check", captured: false }));
  await until(() => callsTo(dom, "setLoginMessage").length > 0);
  assert.match(callsTo(dom, "setLoginMessage").at(-1).args.text, /未登录教务系统/);
  assert.equal(callsTo(dom, "closeLogin").length, 0);
});

test("a save with no captured page says so and keeps the sheet open", async () => {
  const dom = open({ store: { state: SAVED() } });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  dom.win.CurSimplePage.__emit("loginAction", JSON.stringify({ id: "save", captured: false }));
  await until(() => callsTo(dom, "setLoginMessage").length > 0);
  assert.match(callsTo(dom, "setLoginMessage").at(-1).args.text, /没有读取到当前页面/);
  assert.equal(callsTo(dom, "closeLogin").length, 0);
});

test("a school 5xx is shown as the school's problem, not the app's", async () => {
  const dom = open({
    store: { state: SAVED() },
    run: () => { throw { __fail: { code: "script", detail: "教务系统返回 HTTP 503" } }; },
  });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  dom.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(dom).includes("连不上学校的教务系统"));
  assert.match(text(dom), /不是软件的问题/);
});

test("a result for another account is refused and nothing is stored", async () => {
  const dom = open({
    store: { state: SAVED() },
    run: () => ({ loggedIn: true, account: { id: "b", name: "别人" }, section: GRADES }),
  });
  await until(() => text(dom).includes("示例同学"));
  dom.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  dom.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(dom).includes("查询期间账号发生了变化"));
  assert.equal(callsTo(dom, "storageSet").length, 0);
});

test("the page waits for the host bridge when it is not attached yet", async () => {
  const dom = open({ store: { state: SAVED() }, refuseFirstCalls: 2 });
  await until(() => text(dom).includes("示例同学"), 4000);
  assert.match(text(dom), /示例大学/);
  assert.doesNotMatch(text(dom), /cannot reach the app/);
});

test("a late bridge still delivers sign-in sheet actions", async () => {
  const h = open({ delayedShim: true });
  await until(() => text(h).includes("未登录"));
  h.win.CurSimplePage.__emit("loginAction", JSON.stringify({ id: "check", captured: false }));
  await until(() => callsTo(h, "setLoginMessage").some((call) => /登录有效/.test(call.args.text)));
  assert.equal(callsTo(h, "run")[0].args.mode, "checkLogin");
  assert.equal(callsTo(h, "run").length, 1);
  assert.equal(callsTo(h, "closeLogin").length, 0);
  assert.equal(callsTo(h, "saveLogin").length, 0);
  assert.match(text(h), /示例同学/);
});

test("a failed cache write preserves both the visible and stored previous result", async () => {
  const newer = { ...GRADES, rows: [["新课程", "90", "3", "2026-2027-1"]] };
  const old = SAVED();
  const h = open({ store: { state: old }, failStorage: true, run: () => ({ loggedIn: true, account: ACCOUNT, section: newer }) });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("保存空间已满"));
  assert.match(text(h), /数据库原理/);
  assert.doesNotMatch(text(h), /新课程/);
  assert.equal(h.store.state, old);
});

test("duplicate sheet clicks run only one query and cannot clear its cache", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const h = open({ store: { state: SAVED() }, run: () => pending });
  await until(() => text(h).includes("示例同学"));
  h.win.CurSimplePage.__emit("loginAction", JSON.stringify({ id: "check" }));
  h.win.CurSimplePage.__emit("loginAction", JSON.stringify({ id: "check" }));
  await until(() => callsTo(h, "run").length > 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(h, "run").length, 1);
  await h.win.clearCache();
  await h.win.clearCache();
  assert.equal(callsTo(h, "storageRemove").length, 0);
  finish({ loggedIn: true, account: ACCOUNT });
  await until(() => callsTo(h, "setLoginMessage").some((call) => /登录有效/.test(call.args.text)));
  assert.equal(callsTo(h, "closeLogin").length, 0);
});

test("scores never become filter chips and the term filter can be selected", async () => {
  const h = open({ store: { state: SAVED() } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  assert.equal(h.doc.querySelector("select"), null, "no native picker");
  const choices = [...h.doc.querySelectorAll('[data-act="filter-column"]')].map((e) => e.textContent);
  const shown = choices.length ? choices : [h.doc.querySelector(".filter-only").textContent];
  assert.ok(shown.includes("学年学期"));
  assert.ok(!shown.includes("总评成绩"));
  assert.ok(![...h.doc.querySelectorAll(".chip")].some((e) => ["88", "95"].includes(e.textContent)));
  h.doc.querySelector('[data-act="filter"][data-v="2025-2026-2"]').click();
  assert.match(text(h), /程序设计/);
  assert.doesNotMatch(text(h), /数据库原理/);
});

test("a recommended term filter matches each checked term in a matrix row", async () => {
  const section = {
    columns: ["课程名称", "建议修读学期", "学分"],
    rows: [["选修课程", "1、2、3、4", "2"], ["毕业设计", "8", "4"]],
    summary: [],
  };
  const h = open({ store: { state: SAVED(section) } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  const term = h.doc.querySelector('[data-act="filter"][data-v="1"]');
  assert.ok(term, "each checked term must be an individual filter choice");
  term.click();
  assert.match(text(h), /选修课程/);
  assert.doesNotMatch(text(h), /毕业设计/);
});

test("malformed query results cannot replace a previously readable cache", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, run: () => ({ loggedIn: true, account: ACCOUNT, section: { columns: ["课程"], rows: null } }) });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("返回的内容无法识别"));
  assert.match(text(h), /数据库原理/);
  assert.equal(h.store.state, old);
  assert.equal(callsTo(h, "storageSet").length, 0);
});

test("the host back event returns to the plugin menu without discarding cached data", async () => {
  const h = open({ store: { state: SAVED() } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  assert.equal(h.win.__CurSimpleComponentHasBack, true);
  h.win.dispatchEvent(new h.win.Event("cursimple-back"));
  assert.equal(h.win.__CurSimpleComponentHasBack, false);
  assert.match(text(h), /示例同学/);
  assert.equal(callsTo(h, "run").length, 0);
});

test("a damaged cached section does not crash the menu or hide other valid results", async () => {
  const broken = JSON.parse(SAVED());
  broken.accounts.a.sections.plan = { savedAt: 1700000001000, section: { columns: null, rows: "broken" } };
  const h = open({ store: { state: JSON.stringify(broken) } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="plan"]').click();
  assert.ok(h.doc.querySelector('[data-act="back"]'), "the section must actually render, rather than leaving the menu after an exception");
  assert.match(text(h), /尚未查询/);
  h.win.dispatchEvent(new h.win.Event("cursimple-back"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  assert.match(text(h), /数据库原理/);
  assert.equal(callsTo(h, "run").length, 0);
});

test("closing sign-in refreshes the saved-credentials label without any login request", async () => {
  const options = { credentialsSaved: false };
  const h = open(options);
  await until(() => text(h).includes("未保存账号密码"));
  options.credentialsSaved = true;
  h.win.CurSimplePage.__emit("loginClosed", "{}");
  await until(() => text(h).includes("账号密码已加密保存"));
  assert.equal(callsTo(h, "run").length, 0);
  assert.equal(callsTo(h, "openLogin").length, 0);
});

test("clearing saved credentials requires confirmation and leaves the academic cache intact", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, credentialsSaved: true });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="clear-creds"]').click();
  assert.equal(callsTo(h, "clearCredentials").length, 0);
  assert.match(h.doc.querySelector('[data-act="clear-creds"]').textContent, /再点一次确认/);
  h.doc.querySelector('[data-act="clear-creds"]').click();
  await until(() => callsTo(h, "clearCredentials").length === 1);
  await until(() => text(h).includes("未保存账号密码"));
  assert.equal(h.store.state, old);
  assert.equal(callsTo(h, "run").length, 0);
});

test("signed out, the home page shows a visible sign-in button and a sign-in hint", async () => {
  const dom = open({ credentialsSaved: false });
  await until(() => text(dom).includes("未登录"));
  const button = dom.doc.querySelector('.hero-card [data-act="signin"]');
  assert.ok(button, "the account card has a sign-in button");
  assert.notEqual(dom.win.getComputedStyle(button).display, "none", "the sign-in button is not hidden");
  assert.match(dom.doc.querySelector(".hero-school").textContent, /登录后显示/);
  assert.doesNotMatch(dom.doc.querySelector(".hero-card").textContent, /学籍档案与专业信息/);
});

test("with several accounts, the account switcher is visible", async () => {
  const state = JSON.parse(SAVED());
  state.accounts.b = { account: { ...ACCOUNT, id: "b", name: "另一位同学" }, verifiedAt: 1700000000000, sections: {} };
  const dom = open({ store: { state: JSON.stringify(state) } });
  await until(() => text(dom).includes("示例同学"));
  const select = dom.doc.querySelector('.hero-card select[data-act="switch"]');
  assert.ok(select, "the account card has a switcher");
  assert.notEqual(dom.win.getComputedStyle(select).display, "none", "the switcher is not hidden");
});

test("reaching the academic system in the sheet confirms the login, saves it and refreshes every section", async () => {
  const h = open({ credentialsSaved: false, run: everySection });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: "https://gateway.example.edu/portal/" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(h, "run").length, 0, "the gateway page is not the academic system");
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  await until(() => callsTo(h, "run").length === 7 && !text(h).includes("正在更新"));
  assert.equal(callsTo(h, "saveLogin").length, 1, "the typed account is kept");
  assert.equal(callsTo(h, "closeLogin").length, 1, "the sheet closes by itself");
  assert.deepEqual(callsTo(h, "run").slice(1).map((c) => c.args.action.sectionId).sort(), ["credits", "exams", "external", "grades", "overview", "plan"]);
  assert.match(text(h), /示例同学/);
  assert.match(text(h), /账号密码已加密保存/);
  const saved = JSON.parse(h.store.state);
  assert.deepEqual(Object.keys(saved.accounts.a.sections).sort(), ["credits", "exams", "external", "grades", "overview", "plan"]);
});

test("the same system page twice confirms the login only once", async () => {
  const h = open({ run: everySection });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  await until(() => callsTo(h, "closeLogin").length === 1 && !text(h).includes("正在更新"));
  assert.equal(callsTo(h, "run").filter((c) => c.args.mode === "checkLogin").length, 1);
});

test("a system page that is still not signed in waits quietly for the next page", async () => {
  let signedIn = false;
  const h = open({ run: (p) => (signedIn ? everySection(p) : { loggedIn: false }) });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  await until(() => callsTo(h, "run").length === 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(h, "closeLogin").length, 0);
  assert.equal(callsTo(h, "setLoginMessage").length, 0, "no error while the user is still signing in");
  signedIn = true;
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  await until(() => callsTo(h, "closeLogin").length === 1);
});

test("opening a section never fetched for a signed-in account fetches it", async () => {
  const h = open({ store: { state: SAVED() }, run: everySection });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="credits"]').click();
  await until(() => callsTo(h, "run").length === 1 && !h.doc.querySelector(".loading-indicator"));
  assert.equal(callsTo(h, "run")[0].args.action.sectionId, "credits");
  h.doc.querySelector('[data-act="back"]')?.click();
  h.win.dispatchEvent(new h.win.Event("cursimple-back"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(h, "run").length, 1, "a stored section is shown without a query");
});

test("a grade card shows the final mark when the overall mark is blank", async () => {
  const section = {
    id: "grades",
    columns: ["课程名称", "学年学期", "总评成绩", "最终", "绩点"],
    rows: [["劳动教育", "2025-2026 1", "", "100", "5"], ["线性代数", "2025-2026 1", "88", "92", "4.2"]],
    summary: [],
    message: "",
  };
  const h = open({ store: { state: SAVED(section) } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
  const badges = [...h.doc.querySelectorAll(".record-card")].map((card) => card.querySelector(".score-badge")?.textContent || "");
  assert.deepEqual(badges, ["100", "92"], "the final mark wins, and fills in for a blank overall mark");
  assert.doesNotMatch(h.doc.querySelector(".record-card .record-sub").textContent, /100/, "the badge mark is not repeated below");
});

test("the menu lists external grades between grades and the curriculum", async () => {
  const h = open();
  await until(() => text(h).includes("未登录"));
  const ids = [...h.doc.querySelectorAll('.menu-grid [data-act="open"]')].map((b) => b.getAttribute("data-v"));
  assert.deepEqual(ids, ["overview", "grades", "exams", "external", "plan", "credits"]);
  assert.match(text(h), /校外成绩/);
});

test("checking the login keeps every stored result as it is", async () => {
  const h = open({ store: { state: SAVED() }, run: everySection });
  await until(() => text(h).includes("示例同学"));
  const before = JSON.parse(h.store.state).accounts.a.sections;
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => callsTo(h, "run").length === 1 && !h.doc.querySelector(".loading-indicator"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(h, "run")[0].args.mode, "checkLogin");
  assert.equal(callsTo(h, "run").length, 1, "no section is queried");
  assert.equal(callsTo(h, "probe").length, 1);
  assert.equal(callsTo(h, "saveLogin").length, 0);
  assert.equal(callsTo(h, "openLogin").length, 0);
  assert.match(h.doc.querySelector(".badge.ok").textContent, /登录有效/);
  assert.deepEqual(JSON.parse(h.store.state).accounts.a.sections, before);
});

test("a login check reports an expired redirect without opening or submitting login", async () => {
  const old = JSON.parse(SAVED());
  const h = open({ store: { state: JSON.stringify(old) },
    probe: { reachable: true, landedUrl: "https://gateway.example.edu/login" }, run: everySection });
  await until(() => text(h).includes("示例同学"));
  assert.equal(h.doc.querySelector(".badge.ok"), null, "a past verification is not present proof of a session");
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => /登录已过期/.test(h.doc.querySelector(".badges-row").textContent));
  assert.equal(callsTo(h, "run").length, 0);
  for (const method of ["openLogin", "navigateLogin", "saveLogin"]) assert.equal(callsTo(h, method).length, 0);
  assert.deepEqual(JSON.parse(h.store.state).accounts.a.sections, old.accounts.a.sections);
  const reopened = open({ store: h.store });
  await until(() => /登录已过期/.test(reopened.doc.querySelector(".badges-row")?.textContent || ""));
  reopened.doc.querySelector('[data-act="open"][data-v="credits"]').click();
  assert.equal(callsTo(reopened, "probe").length, 0);
  assert.equal(callsTo(reopened, "run").length, 0);
});

test("a new account can check a signed-out session without starting sign-in", async () => {
  const h = open({ credentialsSaved: false, run: () => ({ loggedIn: false }) });
  await until(() => h.doc.querySelector('.hero-card [data-act="check"]'));
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => /未登录教务系统/.test(h.doc.querySelector(".msg-banner")?.textContent || ""));
  assert.equal(callsTo(h, "openLogin").length, 0);
  assert.equal(callsTo(h, "saveLogin").length, 0);
});

test("an offline check does not confuse a network failure with an expired session", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, probe: { reachable: false, online: false }, run: everySection });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => /没有网络/.test(h.doc.querySelector(".msg-banner")?.textContent || ""));
  assert.equal(h.doc.querySelector(".badge.ok"), null);
  assert.equal(callsTo(h, "run").length, 0);
  assert.equal(h.store.state, old);
});

test("a refresh can invalidate a login that was just checked", async () => {
  const old = JSON.parse(SAVED());
  const h = open({ store: { state: JSON.stringify(old) }, run: (call) =>
    call.mode === "checkLogin" ? { loggedIn: true, account: ACCOUNT } : { loggedIn: false } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => h.doc.querySelector(".badge.ok"));
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => /登录已过期/.test(h.doc.querySelector(".msg-banner")?.textContent || ""));
  h.doc.querySelector('[data-act="back"]').click();
  assert.match(h.doc.querySelector(".badges-row").textContent, /登录已过期/);
  assert.equal(h.doc.querySelector(".badge.ok"), null);
  assert.deepEqual(JSON.parse(h.store.state).accounts.a.sections, old.accounts.a.sections);
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => h.doc.querySelector(".badge.ok"));
  assert.equal(JSON.parse(h.store.state).accounts.a.loginIssue, undefined);
});

test("a timed-out login check ignores a late success", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const old = SAVED();
  const h = open({ store: { state: old }, run: () => pending });
  await until(() => text(h).includes("示例同学"));
  h.win.REFRESH_TIMEOUT_MS = 40;
  h.win.LOGIN_CHECK_TIMEOUT_MS = 40;
  h.doc.querySelector('.hero-card [data-act="check"]').click();
  await until(() => /响应超时/.test(h.doc.querySelector(".msg-banner")?.textContent || ""));
  finish({ loggedIn: true, account: ACCOUNT });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.doc.querySelector(".badge.ok"), null);
  assert.equal(h.store.state, old);
  assert.equal(callsTo(h, "openLogin").length, 0);
});

test("reopening the page after a sign-in shows every section from storage without any query", async () => {
  const first = open({ run: everySection });
  await until(() => text(first).includes("未登录"));
  first.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(first, "openLogin").length === 1);
  first.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  await until(() => callsTo(first, "run").length === 7 && !text(first).includes("正在更新"));
  const again = open({ store: first.store, run: everySection });
  await until(() => text(again).includes("示例同学"));
  for (const id of ["overview", "grades", "exams", "external", "plan", "credits"]) {
    again.doc.querySelector(`[data-act="open"][data-v="${id}"]`).click();
    assert.match(text(again), /数据库原理/, `${id} shows its stored rows`);
    again.win.dispatchEvent(new again.win.Event("cursimple-back"));
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(again, "run").length, 0, "nothing is fetched until a manual refresh");
});

test("clearing the cache removes the stored results without querying anything", async () => {
  const h = open({ store: { state: SAVED() }, run: everySection });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="clear"]').click();
  h.doc.querySelector('[data-act="clear"]').click();
  await until(() => text(h).includes("未登录"));
  assert.equal(h.store.state, undefined);
  assert.equal(callsTo(h, "run").length, 0, "clearing does not query by itself");
});

test("entering the academic system covers the sheet until the login is confirmed", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = open({ run: (p) => (p.mode === "checkLogin" ? gate.then(() => everySection(p)) : everySection(p)) });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action", loading: true }));
  await until(() => callsTo(h, "setLoginBusy").length === 1);
  assert.match(callsTo(h, "setLoginBusy")[0].args.title, /正在进入教务系统/);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action", loading: false }));
  await until(() => callsTo(h, "setLoginBusy").length === 2);
  assert.match(callsTo(h, "setLoginBusy")[1].args.title, /正在确认登录/);
  release();
  await until(() => callsTo(h, "closeLogin").length === 1);
});

test("a redirect back to sign-in uncovers the sheet", async () => {
  const h = open({ run: () => ({ loggedIn: false }) });
  await until(() => text(h).includes("未登录"));
  h.win.SETTLE_MS = 20;
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action", loading: true }));
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: "https://gateway.example.edu/login", loading: false }));
  await until(() => callsTo(h, "setLoginBusy").length === 2);
  assert.equal(callsTo(h, "setLoginBusy")[1].args.title, undefined, "the overlay is cleared");
  // A system page that is not signed in also clears it.
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action", loading: false }));
  await until(() => callsTo(h, "setLoginBusy").length === 4);
  assert.equal(callsTo(h, "setLoginBusy")[3].args.title, undefined);
  assert.equal(callsTo(h, "closeLogin").length, 0);
});

const openGrades = async (h) => {
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="grades"]').click();
};

test("refresh checks the system first and does not query when it cannot be reached", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, probe: { online: true, reachable: false }, run: everySection });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("连不上学校的教务系统"));
  assert.equal(callsTo(h, "probe").length, 1);
  assert.equal(callsTo(h, "run").length, 0, "nothing is fetched from an unreachable system");
  assert.equal(h.store.state, old);
  assert.match(text(h), /数据库原理/, "the old rows stay on screen");
});

test("without a network the refresh says so and keeps the old rows", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, probe: { online: false, reachable: false }, run: everySection });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("手机当前没有网络"));
  assert.equal(h.store.state, old);
});

test("a refresh slower than the limit stops, keeps the old rows and ignores the late result", async () => {
  let finish;
  const late = new Promise((resolve) => { finish = resolve; });
  const old = SAVED();
  const h = open({ store: { state: old }, run: () => late });
  await openGrades(h);
  h.win.REFRESH_TIMEOUT_MS = 40;
  h.win.LOGIN_CHECK_TIMEOUT_MS = 40;
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("超过 20 秒"));
  finish({ loggedIn: true, account: ACCOUNT, section: { ...GRADES, rows: [["迟到的课程", "60", "1", "2026-2027-1"]] } });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(h.store.state, old, "the late result is not stored");
  assert.doesNotMatch(text(h), /迟到的课程/);
  assert.match(text(h), /数据库原理/);
});

test("an empty answer never replaces stored rows", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, run: () => ({ loggedIn: true, account: ACCOUNT, section: { ...GRADES, rows: [] } }) });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("为避免覆盖"));
  assert.equal(h.store.state, old);
  assert.match(text(h), /数据库原理/);
});

test("a successful refresh replaces the stored rows", async () => {
  const newer = { ...GRADES, rows: [["新课程", "90", "3", "2026-2027-1"]] };
  const h = open({ store: { state: SAVED() }, run: () => ({ loggedIn: true, account: ACCOUNT, section: newer }) });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("新课程"));
  assert.match(JSON.parse(h.store.state).accounts.a.sections.grades.section.rows[0][0], /新课程/);
});

test("after sign-in an unreachable system stops the refresh before any query", async () => {
  const h = open({ probe: { online: true, reachable: false }, run: (p) => (p.mode === "checkLogin" ? { loggedIn: true, account: ACCOUNT } : everySection(p)) });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action" }));
  await until(() => text(h).includes("连不上学校的教务系统"));
  assert.equal(callsTo(h, "run").filter((c) => c.args.mode === "sync").length, 0);
});

test("a failed refresh shows its reason above the stored rows", async () => {
  const h = open({ store: { state: SAVED() }, probe: { online: true, reachable: false } });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => h.doc.querySelector(".msg-banner"));
  const banner = h.doc.querySelector(".msg-banner");
  const list = h.doc.querySelector(".records-list");
  assert.ok(banner.compareDocumentPosition(list) & h.win.Node.DOCUMENT_POSITION_FOLLOWING, "the reason comes before the list");
});

test("student details show as a profile without search or filters", async () => {
  const overview = { id: "overview", columns: ["项目", "内容"], rows: [["学号", "2099000001"], ["姓名", "示例同学"], ["专业", "计算机科学与技术"], ["年级", "2024"]], summary: [], message: "" };
  const state = JSON.parse(SAVED());
  state.accounts.a.sections.overview = { savedAt: 1700000002000, section: overview };
  const h = open({ store: { state: JSON.stringify(state) } });
  await until(() => text(h).includes("示例同学"));
  h.doc.querySelector('[data-act="open"][data-v="overview"]').click();
  assert.equal(h.doc.querySelectorAll(".profile-row").length, 4);
  assert.match(h.doc.querySelector(".profile-card").textContent, /计算机科学与技术/);
  assert.equal(h.doc.querySelector(".search-input"), null, "no search box");
  assert.equal(h.doc.querySelector('[data-act="filter"]'), null, "no filter chips");
  assert.equal(h.doc.querySelector('[data-act="filter-column"]'), null, "no filter column picker");
});

test("a run address that lands on a sign-in page reports the lost login without querying", async () => {
  const old = SAVED();
  const h = open({ store: { state: old }, probe: { online: true, reachable: true, landedUrl: "https://gateway.example.edu/portal/" }, run: everySection });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("登录已过期"));
  assert.equal(callsTo(h, "run").length, 0);
  assert.deepEqual(JSON.parse(h.store.state).accounts.a.sections, JSON.parse(old).accounts.a.sections);
  h.doc.querySelector('[data-act="back"]').click();
  assert.match(h.doc.querySelector(".badges-row").textContent, /登录已过期/);
  assert.equal(h.doc.querySelector(".badge.ok"), null);
});

test("a run address that stays on the system lets the refresh go ahead", async () => {
  const newer = { ...GRADES, rows: [["新课程", "90", "3", "2026-2027-1"]] };
  const h = open({ store: { state: SAVED() }, probe: { online: true, reachable: true, landedUrl: RUN_ORIGIN + "/eams/home.action" },
    run: () => ({ loggedIn: true, account: ACCOUNT, section: newer }) });
  await openGrades(h);
  h.doc.querySelector('[data-act="refresh"]').click();
  await until(() => text(h).includes("新课程"));
});

test("reaching the gateway workbench moves the sheet on to the academic system once", async () => {
  const h = open({ run: everySection });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  const gateway = "https://atrust.yangtzeu.edu.cn:4443/portal/";
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: gateway, route: "/login", loading: false }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(callsTo(h, "navigateLogin").length, 0, "the sign-in screen is left alone");
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: gateway, route: "/app_center", loading: false }));
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: gateway, route: "/app_center", loading: false }));
  await until(() => callsTo(h, "navigateLogin").length === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(callsTo(h, "navigateLogin").length, 1);
  assert.equal(callsTo(h, "navigateLogin")[0].args.url, RUN_ORIGIN + "/eams/home.action");
});

test("the system's own sign-in pages on the way in do not count as signed in", async () => {
  const h = open({ run: everySection });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  for (const path of ["/eams/localLogin.action", "/eams/login.action"]) {
    h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + path, loading: true }));
    h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + path, loading: false }));
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo(h, "run").length, 0, "no login check on a sign-in page");
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action", loading: false }));
  await until(() => callsTo(h, "closeLogin").length === 1);
});

test("a login check that hangs uncovers the sheet", async () => {
  const h = open({ run: () => new Promise(() => {}) });
  await until(() => text(h).includes("未登录"));
  h.win.CONFIRM_TIMEOUT_MS = 40;
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/home.action", loading: false }));
  await until(() => callsTo(h, "setLoginBusy").some((c) => c.args.title === undefined));
  assert.equal(callsTo(h, "closeLogin").length, 0);
});

test("with several filter columns, tapping a tab switches the chips", async () => {
  const section = { id: "grades", columns: ["课程名称", "学年学期", "课程类别", "总评成绩"],
    rows: [["高数", "2024-1", "必修", "90"], ["体育", "2024-1", "公选", "80"], ["英语", "2024-2", "必修", "85"]], summary: [], message: "" };
  const h = open({ store: { state: SAVED(section) } });
  await openGrades(h);
  const tabs = [...h.doc.querySelectorAll('[data-act="filter-column"]')];
  assert.deepEqual(tabs.map((t) => t.textContent), ["学年学期", "课程类别"]);
  tabs[1].click();
  assert.ok(h.doc.querySelector('[data-act="filter"][data-v="公选"]'), "category chips are shown");
  h.doc.querySelector('[data-act="filter"][data-v="公选"]').click();
  assert.match(text(h), /体育/);
  assert.doesNotMatch(text(h), /高数/);
});

test("with one filter column, its name is shown instead of a picker", async () => {
  const section = { id: "grades", columns: ["课程名称", "学年学期", "总评成绩"],
    rows: [["高数", "2024-1", "90"], ["英语", "2024-2", "85"]], summary: [], message: "" };
  const h = open({ store: { state: SAVED(section) } });
  await openGrades(h);
  assert.equal(h.doc.querySelectorAll('[data-act="filter-column"]').length, 0);
  assert.equal(h.doc.querySelector(".filter-only").textContent, "学年学期");
});

test("filter selection search and expansion keep the same scrolling controls and focus", async () => {
  const h = open({ store: { state: SAVED() } });
  await openGrades(h);
  const tabs = h.doc.querySelector(".filter-tabs");
  const chips = h.doc.querySelector(".chips-scroll");
  const choice = chips.querySelector('[data-v="2025-2026-2"]');
  tabs.scrollLeft = 135;
  chips.scrollLeft = 78;
  choice.focus();
  choice.click();
  assert.equal(h.doc.querySelector(".filter-tabs"), tabs);
  assert.equal(h.doc.querySelector(".chips-scroll"), chips);
  assert.equal(h.doc.activeElement, choice);
  assert.equal(tabs.scrollLeft, 135);
  assert.equal(chips.scrollLeft, 78);
  assert.equal(choice.getAttribute("aria-pressed"), "true");
  assert.equal(h.doc.querySelectorAll(".record-card").length, 1);
  const search = h.doc.querySelector(".search-input");
  search.focus();
  search.value = "程序";
  search.dispatchEvent(new h.win.Event("input", { bubbles: true }));
  assert.equal(h.doc.activeElement, search);
  h.doc.querySelector(".record-toggle").click();
  assert.ok(h.doc.querySelector(".record-kv"));
  assert.equal(h.doc.querySelector(".filter-tabs"), tabs);
  assert.equal(h.doc.querySelector(".chips-scroll"), chips);
  assert.equal(chips.scrollLeft, 78);
  assert.equal(callsTo(h, "run").length, 0);
});

test("changing filter fields preserves the field strip and resets only the value choices", async () => {
  const h = open({ store: { state: SAVED() } });
  await openGrades(h);
  const tabs = h.doc.querySelector(".filter-tabs");
  const oldChoices = h.doc.querySelector(".chips-scroll");
  tabs.scrollLeft = 95;
  oldChoices.querySelector('[data-v="2025-2026-2"]').click();
  const credit = tabs.querySelector('[data-v="2"]');
  credit.focus();
  credit.click();
  assert.equal(h.doc.querySelector(".filter-tabs"), tabs);
  assert.equal(tabs.scrollLeft, 95);
  assert.equal(h.doc.activeElement, credit);
  assert.equal(credit.getAttribute("aria-selected"), "true");
  assert.notEqual(h.doc.querySelector(".chips-scroll"), oldChoices);
  assert.ok(h.doc.querySelector('.chip[data-v="3"]'));
  assert.equal(h.doc.querySelectorAll(".record-card").length, 2);
});

test("the system's own sign-in form hands over the gateway sign-in once", async () => {
  const h = open({ run: everySection });
  await until(() => text(h).includes("未登录"));
  h.doc.querySelector('.hero-card [data-act="signin"]').click();
  await until(() => callsTo(h, "openLogin").length === 1);
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/login.action;jsessionid=x", loading: false }));
  h.win.CurSimplePage.__emit("loginPage", JSON.stringify({ url: RUN_ORIGIN + "/eams/login.action", loading: false }));
  await until(() => callsTo(h, "navigateLogin").length === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(callsTo(h, "navigateLogin").length, 1);
  assert.equal(callsTo(h, "navigateLogin")[0].args.url, RUN_ORIGIN + "/eams/localLogin.action");
});

test("plugin release notes open offline with their own version and return to the menu", async () => {
  const h = open({ store: { state: SAVED() } });
  await until(() => text(h).includes("示例同学"));
  const before = h.calls.length;
  const button = h.doc.querySelector('[data-act="release-notes"]');
  assert.ok(button, "plugin owns a visible release-notes entry");
  button.click();
  assert.equal(h.win.__CurSimpleComponentHasBack, true);
  assert.match(text(h), /插件更新日志/);
  assert.match(text(h), /1\.0\.41/);
  assert.match(text(h), /已发布/);
  assert.match(text(h), /开学日期/);
  assert.equal(h.calls.length, before, "reading notes never calls the host or school");
  h.win.dispatchEvent(new h.win.Event("cursimple-back"));
  assert.equal(h.win.__CurSimpleComponentHasBack, false);
  assert.match(text(h), /示例同学/);
  assert.equal(h.calls.length, before);
});

test("plugin release notes provide all three locales without an app announcement", async () => {
  const h = open();
  await until(() => h.doc.querySelector('[data-act="signin"]'));
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    h.win.L = h.win.I18N[locale];
    h.win.S.view = "release-notes";
    h.win.render();
    assert.ok(h.doc.querySelector('.release-card'));
    assert.ok(h.doc.querySelectorAll('.release-card li').length >= 5);
    assert.doesNotMatch(text(h), /undefined|v0\.8\.2/);
    assert.ok(h.doc.querySelector('[data-act="back"]'));
  }
});
