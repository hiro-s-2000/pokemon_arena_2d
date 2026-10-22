'use strict';
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const OUT=path.resolve(__dirname,'../../確認用画像/pokeSprite-smooth-review');
(async()=>{const root=path.resolve(__dirname,'../..');const server=require('http').createServer((req,res)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.gif':'image/gif'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f))}catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`+encodeURIComponent('確認用画像')+'/pokeSprite-smooth-review/index.html');
 await page.waitForFunction(()=>window.REVIEW&&[...REVIEW.images.values()].every(i=>i.complete&&i.naturalWidth));
 assert.equal(await page.locator('article').count(),9);
 let combinations=0;
 for(const action of ['Idle','Walk','Attack','Hurt','Faint']){
  await page.locator('#action').selectOption(action);await page.locator('#play').click();
  await page.waitForFunction(()=>[...REVIEW.images.values()].every(i=>i.complete&&i.naturalWidth));
  for(const row of ['0','1','3','4']){
   await page.locator('#direction').selectOption(row);
   await page.locator('#frame').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
   const counts=await page.locator('.stage canvas').evaluateAll(cs=>cs.map(c=>{const d=c.getContext('2d').getImageData(0,0,192,192).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i]>0;return n}));
   assert(counts.every(n=>n>400),action+'/'+row+' empty render');combinations+=9;
  }
 }
 await page.locator('#action').selectOption('Faint');
 await page.waitForFunction(()=>!REVIEW.playing);
 assert.equal(await page.evaluate(()=>REVIEW.frame),47);
 await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>REVIEW.frame),47);
 await page.locator('#restart').click();assert.equal(await page.evaluate(()=>REVIEW.playing),true);
 await page.locator('#action').selectOption('Walk');await page.locator('#play').click();
 await page.locator('#frame').fill('0');await page.locator('#step').click();assert.equal(await page.evaluate(()=>REVIEW.frame),1);
 await page.locator('#speed').selectOption('0.25');await page.locator('#direction').selectOption('0');
 await page.locator('#background').selectOption('light');
 await page.screenshot({path:path.join(OUT,'preview-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
 await page.screenshot({path:path.join(OUT,'preview-mobile.png'),fullPage:true});
 await page.goto('file://'+path.join(OUT,'index.html'));
 await page.waitForFunction(()=>window.REVIEW&&[...REVIEW.images.values()].every(i=>i.complete&&i.naturalWidth));
 assert.equal(await page.locator('article').count(),9);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>REVIEW.errors),[]);
 const result={passed:true,deliveryMode:'file:// (server not required)',renderedCombinations:combinations,nonemptyCanvases:true,faintFinalHold:true,step:true,mobileNoOverflow:true,pageErrors:errors};
 fs.writeFileSync(path.join(OUT,'browser-validation.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exit(1)});
