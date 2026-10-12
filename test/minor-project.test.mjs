import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../plugin-packages/yangtzeu-eams/main.js',import.meta.url),'utf8');
const plugin=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {hasMultipleCourseTabs};').toString('base64'));

test('多个培养方案标签会停下来交给用户',()=>{
 const tabs='<ul class="tabs"><li><a href="/eams/courseTableForStd.action?projectId=1">主修</a></li>'+
  '<li><a href="/eams/courseTableForStd.action?projectId=2">辅修</a></li></ul>';
 assert.equal(plugin.hasMultipleCourseTabs(tabs),true);
 assert.equal(plugin.hasMultipleCourseTabs('<option value="1">主修</option><option value="2">双学位</option>'),false);
});

test('页面里出现两个不同的 projectId 也算多套方案',()=>{
 assert.equal(plugin.hasMultipleCourseTabs('<a href="courseTableForStd.action?projectId=1">A</a><a href="courseTableForStd.action?projectId=2">B</a>'),true);
 assert.equal(plugin.hasMultipleCourseTabs('<a href="courseTableForStd.action?projectId=1">A</a><a href="home.action">首页</a>'),false);
});

test('单一培养方案的普通课表页不触发',()=>{
 const single='<ul class="tabs"><li><a href="/eams/courseTableForStd.action?projectId=1">我的课表</a></li></ul>'+
  '<table><tr><td>第一节</td></tr></table>';
 assert.equal(plugin.hasMultipleCourseTabs(single),false);
 assert.equal(plugin.hasMultipleCourseTabs(''),false);
 assert.equal(plugin.hasMultipleCourseTabs('<html><body>课表</body></html>'),false);
});

test('文字里带辅修二字但只有一个方案时不触发',()=>{
 assert.equal(plugin.hasMultipleCourseTabs('<td>辅修专业英语</td><td>辅修课程说明</td>'),false);
});
