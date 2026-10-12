import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../plugin-packages/yangtzeu-eams/main.js',import.meta.url),'utf8');
const plugin=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {matchesCourseAccount,readCapturedCourseDetailHtml,courseUrl,requestTextInPage};').toString('base64'));

test('同一学期也必须匹配学生，缺少身份的旧抓包不参与合并',()=>{
 const meta={semesterId:'42',ids:'student-b'};
 assert.equal(plugin.matchesCourseAccount('semester.id=42&ids=student-b',meta),true);
 assert.equal(plugin.matchesCourseAccount('semester.id=42&ids=student-a',meta),false);
 assert.equal(plugin.matchesCourseAccount('semester.id=41&ids=student-b',meta),false);
 assert.equal(plugin.matchesCourseAccount('semester.id=42',meta),false);
 assert.equal(plugin.matchesCourseAccount('',meta),false);
});

test('代理与直连门户各自在当前登录地址取课表',()=>{
 globalThis.location={href:'https://jwc3.yangtzeu.edu.cn:8443/eams/home.action'};
 assert.equal(plugin.courseUrl('https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/dataQuery.action'),
  'https://jwc3.yangtzeu.edu.cn:8443/eams/dataQuery.action');
 globalThis.location={href:'https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/home.action'};
 assert.equal(new URL(plugin.courseUrl('https://jwc3.yangtzeu.edu.cn/eams/courseTableForStd.action')).hostname,
  'jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn');
 globalThis.location={href:'https://cas.yangtzeu.edu.cn/login'};
 assert.equal(plugin.courseUrl('https://jwc3.yangtzeu.edu.cn/eams/home.action'),'https://jwc3.yangtzeu.edu.cn/eams/home.action');
});

test('旧账号抓包不会补到新账号课表中',async()=>{
 const ctx={web:{packets:async()=>[
  {requestBody:'semester.id=42&ids=student-a',responseBody:'old-account-courses'},
  {requestBody:'semester.id=42',responseBody:'anonymous-courses'},
 ]}};
 assert.deepEqual(await plugin.readCapturedCourseDetailHtml(ctx,{semesterId:'42',ids:'student-b'}),[]);
});

test('请求携带当前会话且绕过 HTTP 缓存',async()=>{
 const previous=globalThis.fetch;let options;
 try{
  globalThis.fetch=async(url,value)=>{options=value;return {ok:true,text:async()=>'<html>fresh-account</html>'};};
  assert.equal(await plugin.requestTextInPage({}, {url:'https://jwc3.yangtzeu.edu.cn/eams/home.action',method:'GET',headers:{}}),'<html>fresh-account</html>');
  assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');
 }finally{globalThis.fetch=previous;}
});
