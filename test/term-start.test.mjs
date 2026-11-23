import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const source = await readFile(new URL("../plugin-packages/yangtzeu-eams/main.js", import.meta.url), "utf8");
const api = new Function(source.replace(/export /g, "") + "\nreturn { parseSemesterList }; ")();
test("timing template never invents a semester start", async () => {
 const timing = JSON.parse(await readFile(new URL("../plugin-packages/yangtzeu-eams/datapack/timing.json", import.meta.url), "utf8"));
 assert.equal(timing.termStartDate, "");
});
test("selected semester dates come from school calendar metadata", () => {
 const items = api.parseSemesterList('{id:"42",schoolYear:"2026",name:"1",beginOn:"2026-09-07"}');
 assert.equal(items[0].termStartDate, "2026-09-07");
});
test("invalid school calendar dates stay unset", () => {
 const items = api.parseSemesterList('{id:"42",schoolYear:"2026",name:"1",beginOn:"2026-02-30"}');
 assert.equal(items[0].termStartDate, null);
});

test("packaged periods do not pretend to know this semester's date", async () => {
 const timing = JSON.parse(await readFile(new URL("../plugin-packages/yangtzeu-eams/datapack/timing.json", import.meta.url), "utf8"));
 assert.equal(timing.termStartDate, "");
 assert.equal(timing.slotTimes.length, 8);
});
