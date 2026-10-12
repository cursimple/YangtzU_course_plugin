import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../plugin-packages/yangtzeu-eams/main.js',import.meta.url),'utf8');
const {buildSchedule}=new Function(source.replace('export async function run','async function run')+';return {buildSchedule};')();
const weeks='0'+'1'.repeat(20);
function activity(seq,positions,teacher='老师',title='课程') {
 return `var teachers = [{"name": ${JSON.stringify(teacher)}}]; activity = new TaskActivity("id",${JSON.stringify(title+'('+seq+')')},"room","教室",${JSON.stringify(weeks)});`+
 positions.map(([day,slot,table=0])=>`index = ${day} * unitCount + ${slot}; table${table}.activities[index][table${table}.activities[index].length] = activity;`).join('');
}
const row=(table,slot,label,rowspan=1)=>`<tr><td rowspan="${rowspan}"><font>${label}</font></td><td id="TD${slot}_${table}"></td></tr>`;
const build=(detailHtml,extra={})=>buildSchedule({meta:{semesterId:'42',maxWeek:20},detailHtml,updatedAt:'today',...extra});
const courses=s=>s.dailySchedules.flatMap(x=>x.courses);

test('同一活动的不同星期必须分别排课，不能合成第一天的一条大跨度课程',()=>{
 const s=build('var unitCount = 8;'+activity('1001',[[0,0],[4,1]]));
 assert.deepEqual(courses(s).map(x=>x.time),[{dayOfWeek:1,startNode:1,endNode:1},{dayOfWeek:5,startNode:2,endNode:2}]);
 assert.equal(new Set(courses(s).map(x=>x.id)).size,2);
});
test('同一天不相邻的课程分别保留，连续节次才合并',()=>{
 const s=build('var unitCount = 8;'+activity('1001',[[0,0],[0,1],[0,3]]));
 assert.deepEqual(courses(s).map(x=>x.time),[{dayOfWeek:1,startNode:1,endNode:2},{dayOfWeek:1,startNode:5,endNode:5}]);
});
test('主修和辅修相同索引使用各自前端行标签，互不串位',()=>{
 const html='var unitCount = 8;'+row(0,0,'第一节')+row(1,0,'午间课')+activity('1001',[[0,0,0]])+activity('2002',[[2,0,1]]);
 const s=build(html);
 assert.deepEqual(courses(s).map(x=>x.time),[{dayOfWeek:1,startNode:1,endNode:1},{dayOfWeek:3,startNode:3,endNode:3}]);
});
test('不同抓包的节次数独立解析，跨行节次继承前端 rowspan',()=>{
 const first='var unitCount = 8;'+row(0,0,'第一节')+activity('1001',[[0,0]]);
 const second='var unitCount = 16;'+row(0,0,'第二节',2)+'<tr><td id="TD1_0"></td></tr>'+activity('2002',[[0,1]]);
 const s=build('',{detailHtmlParts:[first,second]});
 assert.deepEqual(courses(s).map(x=>x.time.startNode),[1,2]);
});
test('纯脚本响应也优先参考当前前端的辅修排布',()=>{
 const frontend=row(0,0,'第一节')+row(1,0,'第四节',2)+'<tr><td id="TD1_1"></td></tr>';
 const s=build('var unitCount = 16;'+activity('2002',[[1,1,1]]),{frontendHtml:frontend});
 assert.deepEqual(courses(s)[0].time,{dayOfWeek:2,startNode:5,endNode:5});
});
test('辅修课程列表调整列序后课程代码、学分仍对应本课程',()=>{
 const list='<tr><th>课程代码</th><th>课程序号</th><th>学分</th></tr><tr><td>MAIN-01</td><td>1001</td><td>4.5</td></tr>'+
 '<tr><th>学分</th><th>课程代码</th><th>课程序号</th></tr><tr><td>2.0</td><td>MINOR-02</td><td>2002</td></tr>';
 const s=build('var unitCount = 8;'+list+activity('1001',[[0,0]])+activity('2002',[[0,1]]));
 assert.equal(courses(s)[1].details.find(x=>x.label==='课程代码').value,'MINOR-02');
 assert.equal(courses(s)[1].details.find(x=>x.label==='学分').value,'2.0');
});
test('转义引号和格式化教师对象正常解析，重复周抓包不重复导课',()=>{
 const html='var unitCount = 8;'+activity('1001',[[0,0]],'老师"甲','课程"A');
 const s=build('',{detailHtmlParts:[html,html]});
 assert.equal(courses(s).length,1);assert.equal(courses(s)[0].title,'课程"A');assert.equal(courses(s)[0].teacher,'老师"甲');
});
