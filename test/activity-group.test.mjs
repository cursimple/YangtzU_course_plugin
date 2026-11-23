import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../plugin-packages/yangtzeu-eams/main.js", import.meta.url), "utf8");
const plugin = await import("data:text/javascript;base64," + Buffer.from(
  source + "\nexport { parseActivities, parseActivityGroup };",
).toString("base64"));

function args(group, room = "实验楼101") {
  return `ids.join(','), names.join(','), "task(123456)", "实验课程(123456)", "room-id", "${room}", "011", null, null, assistantName, "", ${group}`;
}

function page(group, room) {
  return `var teachers = [{ id: 1, name:"张老师" }];
    activity = new TaskActivity(${args(group, room)});
    index = 0 * unitCount + 0;
    table0.activities[index][table0.activities[index].length]=activity;`;
}

test("group comes from its constructor argument despite nested calls and commas in rooms", () => {
  assert.equal(plugin.parseActivityGroup(args('"1"', "实验楼101,南区")), "1");
  assert.equal(plugin.parseActivityGroup(args("'2'")), "2");
  assert.equal(plugin.parseActivityGroup(args("3")), "3");
  assert.equal(plugin.parseActivityGroup(args('"组别：4"')), "4");
});

test("missing and zero groups do not add a placeholder", () => {
  for (const group of ['""', "null", "undefined", "0", '"0"']) {
    assert.equal(plugin.parseActivityGroup(args(group)), "");
    const course = plugin.parseActivities(page(group), 8, 2, {})[0];
    assert.equal(course.location, "实验楼101");
    assert.equal(course.details.some((field) => field.label === "组别"), false);
  }
  assert.equal(plugin.parseActivityGroup('a,b,"task","title","room","weeks"'), "");
});

test("group is kept in the displayed location and course details", () => {
  const course = plugin.parseActivities(page('"1"'), 8, 2, {})[0];
  assert.equal(course.location, "实验楼101 组1");
  assert.deepEqual(course.details.find((field) => field.label === "组别"), { label: "组别", value: "1" });
  assert.deepEqual(course.time, { dayOfWeek: 1, startNode: 1, endNode: 1 });
  assert.deepEqual(course.weeks, [1, 2]);
});

test("a group already present in the room is not duplicated", () => {
  const course = plugin.parseActivities(page('"1"', "实验楼101 组1"), 8, 2, {})[0];
  assert.equal(course.location, "实验楼101 组1");
});

test("different groups of the same course do not collapse into one record", () => {
  const courses = plugin.parseActivities(page('"1"') + page('"2"'), 8, 2, {});
  assert.equal(courses.length, 2);
  assert.notEqual(courses[0].id, courses[1].id);
  assert.deepEqual(courses.map((course) => course.location), ["实验楼101 组1", "实验楼101 组2"]);
});
