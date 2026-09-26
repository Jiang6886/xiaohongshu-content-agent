import { chromium } from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
const {research_run_id:id}=JSON.parse(readFileSync('../data/audit-skills/run.json'));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1366,height:768}});
await context.addInitScript(id=>sessionStorage.setItem('xhs-active-run',id),id);
const page=await context.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const get=async path=>{const r=await context.request.get('http://127.0.0.1:8000/api/v1'+path);if(!r.ok())throw Error(path+': '+r.status());return r.json()};
const run=await get('/research-runs/'+id),report=await get('/research-runs/'+id+'/report'),notes=await get('/research-runs/'+id+'/notes?page_size=100'),topics=await get('/research-runs/'+id+'/topics');
const valid=notes.items.filter(n=>!n.excluded);
const checks={
 sampleCount:report.summary.valid_notes===valid.length,
 authorCount:report.summary.distinct_authors===new Set(valid.filter(n=>n.author!=='未知作者').map(n=>n.author_id||n.author)).size,
 groupCount:report.summary.topic_groups===new Set(valid.map(n=>n.topic)).size,
 topicCount:report.summary.candidate_topics===topics.length,
 evidence:topics.every(t=>t.evidence_ids.length>0 && t.evidence_ids.every(id=>valid.some(n=>n.id===id))),
};
const results={run,report,notes,topics,checks,views:[],errors};
await page.goto('http://127.0.0.1:8000/research');
await page.locator('.heading').waitFor();
await page.screenshot({path:'../docs/design/skills-research-status.png',fullPage:true});
results.researchText=await page.locator('.run-list').innerText();
results.researchSize=await page.evaluate(()=>({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth}));
await page.goto('http://127.0.0.1:8000/analysis');
await page.locator('.stat').first().waitFor();
for(const [i,tab] of ['研究概览','标题观察','候选选题','样本明细'].entries()){
 await page.getByTitle(tab,{exact:true}).click();
 await page.screenshot({path:`../docs/design/skills-analysis-${i}.png`,fullPage:true});
 if(tab==='候选选题' && topics.length){
   const shown=[];
   for(let p=1;p<=Math.ceil(topics.length/2);p++){
     if(p>1) await page.locator('.topic-pagination .ant-pagination-next').click();
     shown.push(...await page.locator('.candidate-topics h3').allTextContents());
     if(p>1) await page.screenshot({path:`../docs/design/skills-topics-page-${p}.png`,fullPage:true});
   }
   checks.allTopicsReachable=JSON.stringify(shown)===JSON.stringify(topics.map(t=>t.title));
 }
 results.views.push({tab,stats:await page.locator('.stat strong').allTextContents(),text:await page.locator('.content').innerText(),size:await page.evaluate(()=>({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,viewport:innerHeight}))});
}
checks.screenStats=results.views.every(v=>JSON.stringify(v.stats)===JSON.stringify([report.summary.valid_notes,report.summary.distinct_authors,report.summary.topic_groups,report.summary.candidate_topics].map(String)));
checks.desktop=results.views.every(v=>v.size.height<=768 && v.size.width<=1366);
checks.researchDesktop=results.researchSize.height<=768 && results.researchSize.width<=1366;
if(notes.items.length){
 const sample=notes.items[0];
 const row=page.locator('tbody .title-button').first();
 checks.firstSample=(await row.innerText()).includes(sample.title);
 await row.click();
 await page.getByText('来源证据',{exact:true}).waitFor();
 const drawer=page.locator('.ant-drawer-body');
 checks.noteBody=(await drawer.locator('.note-body').innerText())===sample.body;
 checks.source=(await drawer.getByRole('link',{name:'打开小红书原文 ↗'}).getAttribute('href'))===sample.source_url;
 const metrics=await drawer.locator('.evidence-stats').innerText();
 const fmt=n=>n===null?'未知':n.toLocaleString('zh-CN');
 checks.metrics=metrics.includes('点赞 '+fmt(sample.likes)) && metrics.includes('收藏 '+fmt(sample.saves)) && metrics.includes('评论 '+fmt(sample.comments));
 await page.screenshot({path:'../docs/design/skills-note-detail.png',fullPage:true});
}
await page.goto('http://127.0.0.1:8000/writing');
await page.locator('.writing-layout').waitFor();
await page.screenshot({path:'../docs/design/skills-writing.png',fullPage:true});
checks.writingDesktop=await page.evaluate(()=>document.documentElement.scrollHeight<=768 && document.documentElement.scrollWidth<=1366);
writeFileSync('../data/audit-skills/audit.json' ,JSON.stringify(results,null,2));
console.log(JSON.stringify({status:run.status,error:run.error,summary:report.summary,checks,views:results.views.map(v=>({tab:v.tab,stats:v.stats,size:v.size})),errors}));
await browser.close();
