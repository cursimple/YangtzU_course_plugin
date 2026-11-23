import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../plugin-packages/yangtzeu-eams/main.js", import.meta.url), "utf8");
const plugin = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const HOME = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/courseTableForStd.action";
const ENTRY = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/localLogin.action";

function page(href) {
  const store = new Map();
  const location = { href };
  globalThis.location = location;
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  return location;
}
const ctx = { web: { open() {} }, schedule: { addCourse() {}, commit() {} } };
afterEach(() => { delete globalThis.location; delete globalThis.sessionStorage; });

test("the signed-in gateway workbench goes on to the academic system by itself", async () => {
  const location = page("https://atrust.yangtzeu.edu.cn:4443/portal/?redirectid=0.1#/app_center");
  const result = await plugin.run(ctx);
  assert.equal(result.status, "opening-academic-system");
  assert.equal(location.href, HOME, "a live system session is used as is");
});

test("the gateway sign-in and SMS screens are left to the user", async () => {
  for (const href of ["https://atrust.yangtzeu.edu.cn:4443/portal/#/login",
    "https://atrust.yangtzeu.edu.cn:4443/portal/?redirectid=0.1#/smsAuth?authId=x"]) {
    const location = page(href);
    const result = await plugin.run(ctx);
    assert.notEqual(result.status, "opening-academic-system", href);
    assert.equal(location.href, href);
  }
});

test("landing back on the workbench does not loop straight away", async () => {
  const location = page("https://atrust.yangtzeu.edu.cn:4443/portal/#/app_center");
  await plugin.run(ctx);
  location.href = "https://atrust.yangtzeu.edu.cn:4443/portal/#/app_center";
  const again = await plugin.run(ctx);
  assert.equal(again.status, "waiting-course-home-page");
  assert.equal(location.href, "https://atrust.yangtzeu.edu.cn:4443/portal/#/app_center");
});

test("the system's own sign-in form hands over the gateway sign-in once", async () => {
  const location = page("https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/login.action;jsessionid=x");
  const result = await plugin.run(ctx);
  assert.equal(result.status, "signing-in-academic-system");
  assert.equal(location.href, ENTRY);
  location.href = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/login.action";
  assert.notEqual((await plugin.run(ctx)).status, "signing-in-academic-system", "no loop");
});

test("academic navigation suppresses the gateway referrer rejected by the proxy", async () => {
  const metas = [];
  globalThis.document = {
    head: { appendChild(node) { metas.push(node); } },
    createElement() { return {}; },
  };
  try {
    const location = page("https://atrust.yangtzeu.edu.cn:4443/portal/#/app_center");
    await plugin.run(ctx);
    assert.equal(location.href, HOME);
    assert.ok(metas.some((meta) => meta.name === "referrer" && meta.content === "no-referrer"));
  } finally {
    delete globalThis.document;
  }
});
