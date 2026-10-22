'use strict';
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'確認用画像/pokeSprite-smooth-review/bulbasaur-eight-directions');
(async()=>{
 const server=require('http').createServer((req,res)=>{try{const f=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!f.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png'})[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f))}catch{res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`+encodeURIComponent('確認用画像')+'/pokeSprite-smooth-review/bulbasaur-eight-directions/index.html');
  await page.waitForFunction(()=>window.EIGHT_DEBUG&&[...EIGHT_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));
  assert.equal(await page.locator('#directions canvas').count(),8);
  let combinations=0;
  for(const action of ['Idle','Walk','Attack','Hurt','Faint']){
   await page.locator('#action').selectOption(action);await page.locator('#play').click();
   await page.waitForFunction(()=>[...EIGHT_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));
   for(const step of [0,.5,1]){
    await page.locator('#frame').evaluate((el,t)=>{el.value=Math.round(+el.max*t);el.dispatchEvent(new Event('input',{bubbles:true}))},step);
    const counts=await page.locator('#directions canvas').evaluateAll(cs=>cs.map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i]>0;return n}));assert(counts.every(n=>n>400));combinations+=8;
   }
  }
  await page.locator('#action').selectOption('Idle');await page.locator('#play').click();await page.locator('#frame').fill('0');
  const facingHashes=await page.locator('#directions canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()));assert.equal(new Set(facingHashes).size,8,'All Idle facings should differ');
  for(let i=0;i<8;i++){await page.locator('#directions button').nth(i).click();assert.equal(await page.locator('#direction').inputValue(),String(i));}
  await page.locator('#action').selectOption('Faint');await page.waitForFunction(()=>!EIGHT_DEBUG.playing);assert.equal(await page.evaluate(()=>EIGHT_DEBUG.frame),47);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>EIGHT_DEBUG.frame),47);
  await page.locator('#restart').click();assert.equal(await page.evaluate(()=>EIGHT_DEBUG.playing),true);
  await page.locator('#action').selectOption('Walk');await page.locator('#play').click();await page.locator('#frame').fill('0');await page.locator('#step').click();assert.equal(await page.evaluate(()=>EIGHT_DEBUG.frame),1);
  await page.locator('#direction').selectOption('2');await page.locator('#speed').selectOption('0.5');
  await page.screenshot({path:path.join(OUT,'preview-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(OUT,'preview-mobile.png'),fullPage:true});
  await page.goto('file://'+path.join(OUT,'index.html'));await page.waitForFunction(()=>window.EIGHT_DEBUG&&[...EIGHT_DEBUG.images.values()].every(i=>i.complete&&i.naturalWidth));
  assert.deepEqual(await page.evaluate(()=>EIGHT_DEBUG.errors),[]);assert.deepEqual(errors,[]);
  const result={passed:true,renderedCombinations:combinations,eightDistinctIdleDirections:true,directionButtons:8,faintFinalHold:true,frameStep:true,mobileNoOverflow:true,fileProtocol:true,pageErrors:errors};
  fs.writeFileSync(path.join(OUT,'browser-validation.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exit(1)});
