// Usage: NODE_PATH=<directory containing playwright> node tools/test-pmd-workshop-browser.js <chromium executable>
const {chromium}=require('playwright');
const path=require('path'),assert=require('assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.argv[2]});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('file://'+path.resolve(__dirname,'../workshop/charizard-mega-x/build/preview.html'));
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('コマ'));
    await page.locator('#play').click();await page.locator('#anim').selectOption('Attack');
    await page.locator('#next').click();assert.match(await page.locator('#status').textContent(),/コマ 2\/14/);
    await page.locator('#prev').click();assert.match(await page.locator('#status').textContent(),/コマ 1\/14/);
    await page.locator('#onion').check();await page.locator('#speed').selectOption('0.25');
    await page.locator('#zoom').selectOption('1');await page.locator('#bg').fill('#ffffff');
    assert.equal(await page.locator('canvas').count(),8);
    for(const name of ['Idle','Walk','Attack','Shoot','SpAttack','Charge','Strike','Hurt']){
      await page.locator('#anim').selectOption(name);
      await page.waitForFunction(()=>[...document.querySelectorAll('canvas')].every(c=>c.width>0));
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('canvas')].every(c=>{
        const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data;
        let varied=false;for(let i=4;i<d.length;i+=4)if(d[i]!==d[0]||d[i+1]!==d[1]||d[i+2]!==d[2]){varied=true;break;}return varied;
      })),true);
    }
    await page.locator('#anim').selectOption('Idle');await page.locator('#onion').uncheck();
    await page.locator('#zoom').selectOption('2');await page.locator('#bg').fill('#cbd0d8');
    await page.screenshot({path:path.resolve(__dirname,'../workshop/charizard-mega-x/build/browser-check.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('PASS: eight animation modes render all eight directions; stepping, controls, and page error checks passed.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
