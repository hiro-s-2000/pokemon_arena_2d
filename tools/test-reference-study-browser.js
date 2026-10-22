// Browser audit of the offline review page: every form, palette, action and facing.
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..'),out=path.join(ROOT,'確認用画像');
const catalog=JSON.parse(fs.readFileSync(path.join(out,'reference-study/catalog.json')));
(async()=>{
  const server=require('http').createServer((req,res)=>{
    try{const filename=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(!filename.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
      const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.gif':'image/gif','.json':'application/json'};
      res.setHeader('Content-Type',types[path.extname(filename)]||'text/plain');res.end(fs.readFileSync(filename));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const b=await chromium.launch({headless:true,executablePath:process.argv[2]});
  try{
    const p=await b.newPage({viewport:{width:1440,height:1100}}),errors=[],failed=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>failed.push(r.url()));
    await p.goto(`http://127.0.0.1:${server.address().port}/`+encodeURIComponent('確認用画像')+'/PMD-Debug.html');
    await p.waitForFunction(()=>window.PMD_DEBUG&&document.querySelector('#frame').textContent.includes('コマ'));
    await p.locator('#play').click();let views=0,directions=0;
    for(const r of catalog.records){
      await p.locator('#pokemon').selectOption(r.id);
      for(const v of ['normal','shiny']){
        await p.locator('#variant').selectOption(v);
        await p.waitForFunction(()=>[...images.values()].every(i=>i.complete&&i.naturalWidth));
        for(const name of catalog.actions){
          await p.locator('#action').selectOption(name);
          const a=r.variants[v].anims[name];
          await p.waitForFunction(n=>document.querySelector('#frame').textContent===`1 / ${n} コマ`,a.frames);
          const last=a.frames-1;
          await p.locator('#scrub').evaluate((el,n)=>{el.value=String(n);el.dispatchEvent(new Event('input',{bubbles:true}));},last);
          assert.equal(await p.locator('#frame').textContent(),`${a.frames} / ${a.frames} コマ`);
          assert.equal(await p.locator('#directions canvas').count(),8);assert.equal(await p.locator('#motions canvas').count(),9);
          const counts=await p.locator('#directions canvas').evaluateAll(list=>list.map(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<a.length;i+=4)colors.add(`${a[i]},${a[i+1]},${a[i+2]}`);return colors.size;}));
          assert(counts.every(n=>n>=5),r.id+'/'+v+'/'+name+' missing render');views++;
        }
        for(let row=0;row<8;row++){await p.locator('#direction').selectOption(String(row));assert((await p.locator('#focus-title').textContent()).endsWith(catalog.dirs[row]));directions++;}
      }
      console.log('Checked '+r.id, true);
    }
    await p.locator('#pokemon').selectOption('0006_charizard-mega-x');await p.locator('#variant').selectOption('normal');await p.locator('#action').selectOption('Attack');await p.locator('#direction').selectOption('2');
    await p.locator('#next').click();assert.match(await p.locator('#frame').textContent(),/^2 \/ /);
    await p.locator('#prev').click();assert.match(await p.locator('#frame').textContent(),/^1 \/ /);
    await p.locator('#onion').check();await p.locator('#speed').selectOption('0.25');await p.locator('#zoom').selectOption('3');await p.locator('#bg').fill('#eeeeee');
    await p.locator('#play').click();const before=await p.locator('#frame').textContent();await p.waitForFunction(s=>document.querySelector('#frame').textContent!==s,before);await p.locator('#play').click();
    await p.locator('#onion').uncheck();await p.locator('#zoom').selectOption('2');await p.locator('#bg').fill('#c6ccd6');
    await p.waitForFunction(()=>[...images.values()].every(i=>i.complete&&i.naturalWidth));
    await p.screenshot({path:path.join(out,'reference-study/debug-desktop.png'),fullPage:true});
    await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(out,'reference-study/debug-mobile.png'),fullPage:true});
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile horizontal overflow');
    // Also check the actual delivery mode: double-clicking the HTML works without a server.
    await p.goto('file://'+path.join(out,'PMD-Debug.html'));
    await p.waitForFunction(()=>window.PMD_DEBUG&&[...images.values()].every(i=>i.complete&&i.naturalWidth));
    assert.equal(await p.locator('#motions canvas').count(),9);
    assert.deepEqual(await p.evaluate(()=>window.PMD_DEBUG.imageErrors),[]);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    const report={passed:true,views,directionSwitches:directions,pageErrors:errors,failedRequests:failed};
    fs.writeFileSync(path.join(out,'reference-study/browser-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
  }finally{await b.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
