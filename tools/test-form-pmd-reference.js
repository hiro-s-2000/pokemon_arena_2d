'use strict';
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'確認用画像/pokeSprite-smooth-review');
(async()=>{const server=require('http').createServer((req,res)=>{try{const f=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!f.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.gif':'image/gif'})[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f))}catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--js-flags=--expose-gc']});
try{const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[],httpErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('favicon'))httpErrors.push(r.url())});
await page.goto(`http://127.0.0.1:${server.address().port}/`+encodeURIComponent('確認用画像')+'/pokeSprite-smooth-review/index.html');await page.waitForFunction(()=>window.ROSTER_DEBUG);
const records=await page.evaluate(()=>ROSTER_DEBUG.data.records);assert.equal(records.length,16);assert.equal(await page.locator('#gallery button').count(),16);
let renders=0;const distinctDirections={};
for(const r of records){await page.locator('#pokemon').selectOption(r.id);
 for(const name of ['Idle','Walk','Attack','Hurt','Faint']){
  await page.locator('#action').selectOption(name);await page.locator('#play').click();
  await page.waitForFunction(()=>ROSTER_DEBUG.images.size===1&&[...ROSTER_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));
  for(const t of [0,.5,1]){await page.locator('#frame').evaluate((el,t)=>{el.value=Math.round(+el.max*t);el.dispatchEvent(new Event('input',{bubbles:true}))},t);
   const pixels=await page.locator('#directions canvas').evaluateAll(cs=>cs.map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i]>0;return n}));assert(pixels.every(n=>n>200),r.id+'/'+name+'/'+t);renders+=8;
   if(name==='Idle'&&t===0){const strings=await page.locator('#directions canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()));distinctDirections[r.id]=new Set(strings).size;assert.equal(distinctDirections[r.id],8,r.id+' Idle facings');}
  }
  await page.evaluate(()=>{if(window.gc)gc()});
 }
 console.log('CHECKED '+r.id);
}
for(const r of records.filter(r=>r.category!=='normal')){
 await page.locator('#pokemon').selectOption(r.id);assert.equal(await page.locator('#style').inputValue(),'detail');
 assert.match(await page.locator('#method').textContent(),/PMD 8方向・形態部位改訂/);
 await page.locator('#style').selectOption('pmd');assert.match(await page.locator('#method').textContent(),/8方向/);
 for(const name of ['Idle','Walk','Attack','Hurt','Faint']){
  await page.locator('#action').selectOption(name);await page.locator('#play').click();
  await page.waitForFunction(()=>[...ROSTER_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));
  for(const t of [0,.5,1]){await page.locator('#frame').evaluate((el,t)=>{el.value=Math.round(+el.max*t);el.dispatchEvent(new Event('input',{bubbles:true}))},t);
   const counts=await page.locator('#directions canvas').evaluateAll(cs=>cs.map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i]>0;return n}));assert(counts.every(n=>n>200));renders+=8;}
  await page.evaluate(()=>{if(window.gc)gc()});
 }
 console.log('PMD TOGGLE CHECKED '+r.id);
}
for(const [filter,count]of [['normal',9],['mega',4],['gigantamax',3],['all',16]]){await page.locator('#filter').selectOption(filter);assert.equal(await page.locator('#gallery button').count(),count);}
await page.locator('#gallery button[data-id="0006_charizard-gmax"]').click();assert.equal(await page.locator('#pokemon').inputValue(),'0006_charizard-gmax');
await page.locator('#action').selectOption('Faint');await page.waitForFunction(()=>!ROSTER_DEBUG.playing);assert.equal(await page.evaluate(()=>ROSTER_DEBUG.frame),47);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>ROSTER_DEBUG.frame),47);
await page.locator('#restart').click();assert(await page.evaluate(()=>ROSTER_DEBUG.playing));
await page.locator('#action').selectOption('Walk');await page.locator('#play').click();await page.locator('#frame').fill('0');await page.locator('#step').click();assert.equal(await page.evaluate(()=>ROSTER_DEBUG.frame),1);
for(let i=0;i<8;i++){await page.locator('#directions button').nth(i).click();assert.equal(await page.locator('#direction').inputValue(),String(i))}
await page.locator('#speed').selectOption('0.5');await page.locator('#background').selectOption('light');await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>[...ROSTER_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));
await page.screenshot({path:path.join(OUT,'form-reference-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(OUT,'form-reference-mobile.png'),fullPage:true});
await page.goto('file://'+path.join(OUT,'index.html')+'?pokemon=0009_blastoise-mega');await page.waitForFunction(()=>window.ROSTER_DEBUG&&[...ROSTER_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));assert.equal(await page.locator('#pokemon').inputValue(),'0009_blastoise-mega');assert.deepEqual(await page.evaluate(()=>ROSTER_DEBUG.errors),[]);
// The original GIF review and the approved one-species comparison must still load.
await page.goto('file://'+path.join(OUT,'bulbasaur-eight-directions/index.html'));await page.waitForFunction(()=>window.EIGHT_DEBUG&&[...EIGHT_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));assert.deepEqual(await page.evaluate(()=>EIGHT_DEBUG.errors),[]);
assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
const report={passed:true,entries:records.length,renderedCombinations:renders,distinctIdleDirections:distinctDirections,filters:{normal:9,mega:4,gigantamax:3},faintHold:true,step:true,allDirectionButtons:true,fileProtocol:true,bulbasaurComparisonReadable:true,formStyleToggleCount:7,mobileNoOverflow:true,pageErrors:errors,httpErrors};fs.writeFileSync(path.join(OUT,'form-reference-browser-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exit(1)});
