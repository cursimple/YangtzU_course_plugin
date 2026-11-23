import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../plugin-packages/yangtzeu-eams/main.js", import.meta.url), "utf8");
const plugin = await import("data:text/javascript;base64," + Buffer.from(
  source + "\nexport { parseActivities };",
).toString("base64"));

// Same shape as the school's script: the lesson's teachers, then this activity's teachers.
const ZHAO = '{id:101,name:"赵杰",lab:false}';
const YANG = '{id:102,name:"杨琴Y3",lab:false}';
function block(lessonTeachers, actTeachers, weeks, room, slot) {
  return `var teachers = [${lessonTeachers.join(",")}];
    var actTeachers = [${actTeachers.join(",")}];
    var assistant = _.filter(actTeachers, function(actTeacher) { return actTeacher.lab == true; });
    var actTeacherId = []; var actTeacherName = [];
    activity = new TaskActivity(actTeacherId.join(','),actTeacherName.join(','),"1(789435)","大学物理B（下）(789435)","r","${room}","${weeks}",null,null,assistantName,"","");
    index = 1 * unitCount + ${slot};
    table0.activities[index][table0.activities[index].length]=activity;`;
}

test("each activity keeps its own teacher when a course has two", () => {
  const html = block([ZHAO, YANG], [YANG], "0000000111", "东13-B-211c", 0) +
    block([ZHAO, YANG], [ZHAO], "0111111000", "东13-B-211c", 1);
  const courses = plugin.parseActivities(html, 8, 9, {});
  assert.deepEqual(courses.map((course) => course.teacher), ["杨琴Y3", "赵杰"]);
  assert.notEqual(courses[0].id, courses[1].id);
});

test("an activity taught by both teachers lists both", () => {
  const courses = plugin.parseActivities(block([ZHAO, YANG], [ZHAO, YANG], "011", "东13-B-211c", 0), 8, 2, {});
  assert.equal(courses[0].teacher, "赵杰、杨琴Y3");
});

test("a lab-only assistant is left out, as on the school's page", () => {
  const assistant = '{id:900,name:"实验助教",lab:true}';
  const courses = plugin.parseActivities(block([ZHAO], [ZHAO, assistant], "011", "实验楼", 0), 8, 2, {});
  assert.equal(courses[0].teacher, "赵杰");
});

test("older pages without actTeachers still list every lesson teacher", () => {
  const html = `var teachers = [${ZHAO},${YANG}];
    activity = new TaskActivity(ids.join(','),names.join(','),"1(789435)","大学物理B（下）(789435)","r","东13","011",null,null,"","","");
    index = 0 * unitCount + 0;
    table0.activities[index][table0.activities[index].length]=activity;`;
  assert.equal(plugin.parseActivities(html, 8, 2, {})[0].teacher, "赵杰、杨琴Y3");
});

test("with no names at all the course list's teacher is used", () => {
  const courses = plugin.parseActivities(block([], [], "011", "东13", 0), 8, 2, { "789435": "赵杰,杨琴Y3" });
  assert.equal(courses[0].teacher, "赵杰,杨琴Y3");
});
