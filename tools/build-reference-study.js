#!/usr/bin/env node
'use strict';
// A review-only batch: source hierarchy is preserved; installed game assets are never written.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const G=require('./build-gif-anim'),P=require('./pixelize'),R=require('./build-recolor-anim'),SC=require('./build-mega-parts');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/reference-study');
const REV='334639a66c5c70bccfe4e32fbb7d9b7c5043bae9';
const ACTIONS=['Idle','Walk','Attack','Shoot','SpAttack','Charge','Strike','Hurt','Faint'];
const DIRS=['S','SE','E','NE','N','NW','W','SW'];
const roster=JSON.parse(fs.readFileSync(path.join(ROOT,'pokeData/index.json'))).pokemon;
const selected=roster.filter(p=>/^000[1-9]_/.test(p.id));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const rgb=h=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
const hex=a=>Buffer.from(a).toString('hex');
function writeJSON(f,o){fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n');}
function copy(im){return{w:im.w,h:im.h,data:new Uint8Array(im.data)};}
function palette(sheets){const m=new Map();for(const im of Object.values(sheets))for(let i=0;i<im.data.length;i+=4)if(im.data[i+3]){const k=hex(im.data.subarray(i,i+3));m.set(k,(m.get(k)||0)+1);}return m;}
function remap(sheets,fn){const memo=new Map();for(const im of Object.values(sheets))for(let i=0;i<im.data.length;i+=4)if(im.data[i+3]){const h=hex(im.data.subarray(i,i+3));if(!memo.has(h))memo.set(h,fn(...rgb(h)));im.data.set(memo.get(h),i);}}
function limitPalette(sheets){
  const counts=palette(sheets), groups=[...counts].map(([h,w])=>({h,w,lab:P.rgbToOklab(...rgb(h)),members:[h]}));
  while(groups.length>15){let best=Infinity,bi=-1,bj=-1;
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
      const a=groups[i],b=groups[j];if(a.h==='000000'||b.h==='000000')continue;
      const dist=a.lab.reduce((s,v,k)=>s+(v-b.lab[k])**2,0),chromaA=Math.hypot(a.lab[1],a.lab[2]),chromaB=Math.hypot(b.lab[1],b.lab[2]);
      const angle=Math.abs(Math.atan2(a.lab[2],a.lab[1])-Math.atan2(b.lab[2],b.lab[1]));
      const huePenalty=chromaA>.05&&chromaB>.05&&Math.min(angle,2*Math.PI-angle)>Math.PI/3?30:1;
      const score=dist*(a.w*b.w/(a.w+b.w))*huePenalty;
      if(score<best){best=score;bi=i;bj=j;}
    }
    if(bi<0)throw Error('Cannot reduce palette');
    let a=groups[bi],b=groups[bj];if(b.w>a.w){a.h=b.h;a.lab=b.lab;}a.w+=b.w;a.members.push(...b.members);groups.splice(bj,1);
  }
  const map=Object.fromEntries(groups.flatMap(g=>g.members.map(h=>[h,rgb(g.h)])));
  remap(sheets,(...c)=>map[hex(c)]);return {before:counts.size,after:groups.length};
}
function shinyMap(src,sheets,id){
  const votes=new Map();
  for(const side of ['front','back']){
    const A=P.decodePng(path.join(src,side+'.png')),B=P.decodePng(path.join(src,side+'-shiny.png'));
    if(A.w!==B.w||A.h!==B.h)throw Error('Shiny source dimensions mismatch '+src);
    for(let i=0;i<A.data.length;i+=4)if(A.data[i+3]&&B.data[i+3]){const a=hex(A.data.subarray(i,i+3)),b=hex(B.data.subarray(i,i+3));if(!votes.has(a))votes.set(a,new Map());const v=votes.get(a);v.set(b,(v.get(b)||0)+1);}
  }
  const pairs=[...votes].map(([a,m])=>{const b=[...m].sort((a,b)=>b[1]-a[1])[0][0];return{from:a,to:b,lab:P.rgbToOklab(...rgb(a)),target:P.rgbToOklab(...rgb(b)),weight:[...m.values()].reduce((s,n)=>s+n,0)};});
  const map={};
  for(const h of palette(sheets).keys()){
    if(h==='000000'){map[h]=[0,0,0];continue;}
    const lab=P.rgbToOklab(...rgb(h));let best=Infinity,q;
    for(const p of pairs){if(Math.max(...rgb(p.from))<24)continue;const cost=lab.reduce((s,v,k)=>s+(v-p.lab[k])**2,0);if(cost<best){best=cost;q=p;}}
    if(!q)throw Error('No shiny correspondences');
    map[h]=P.oklabToRgb(lab.map((v,i)=>v+q.target[i]-q.lab[i]));
  }
  // PMD reds can be closer to pokeSprite fire than to its body. Explicit material roles prevent
  // a shiny charcoal body from remaining orange, and separate shell colours from the belly.
  const overrides={
    '0006_charizard':{'d73f00':'5a5a6a','9f0000':'313941','ff875f':'837b94','373f8f':'831029','fff700':'e6e610','dfb700':'e6b410','a76f00':'ad7210'},
    '0006_charizard-mega-y':{'d64008':'5a5a6a','d73f00':'5a5a6a','9f0000':'43475a','ff875f':'8b80a0','384092':'831029','373f8f':'831029','fff500':'ffd510','dfb500':'e6b410','a56f09':'ad7210'},
    '0007_squirtle':{'d73f00':'5aac29','9f0000':'105a10','ff875f':'8bcd4a'},
    '0008_wartortle':{'773f00':'295200','af671f':'5a8b10','df771f':'7ba429','ff9747':'a4cd52'}
  }[id]||{};
  for(const[h,to]of Object.entries(overrides))if(map[h])map[h]=rgb(to);
  return {map,materialOverrides:overrides,pairs:pairs.map(p=>({from:p.from,to:p.to,pixels:p.weight}))};
}
function resolve(dir,data,name){
  let a=SC.resolveAnim(dir,data,name);if(a)return a;
  for(const alias of name==='Faint'?['Sleep','Hurt']:name==='Charge'?['Idle']:[]){a=SC.resolveAnim(dir,data,alias);if(a)return a;}
  return null;
}
function measure(im,a){let top=a.fh,bottom=-1,left=a.fw,right=-1;for(let f=0;f<a.frames;f++)for(let y=0;y<a.fh;y++)for(let x=0;x<a.fw;x++)if(im.data[(y*im.w+f*a.fw+x)*4+3]){top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}return {bodyW:right-left+1,bodyH:bottom-top+1,anchorY:bottom+1};}
function buildEntry(p){
  const dex=p.id.slice(0,4),base=roster.find(x=>x.id.startsWith(dex+'_')&&x.category!=='mega'&&x.category!=='gigantamax');
  const direct=p.id===base.id||p.id==='0006_charizard-mega-x',sc=p.id==='0006_charizard-mega-x'?'0006/0001':p.id==='0001_bulbasaur'?'0001/0001':dex;
  const dir=path.join(ROOT,'.cache/SpriteCollab/sprite',sc),data=SC.readAnimData(dir),src=path.dirname(p.sprite.replace('../pokeSprite/',''));
  const input=path.join(ROOT,'pokeSprite',src),dest=path.join(OUT,src);fs.mkdirSync(dest,{recursive:true});
  let spec=direct?null:R.partsOf(p.id);if(!direct&&!spec)throw Error('Missing form parts '+p.id);
  if(spec){spec=JSON.parse(JSON.stringify(spec));spec.grow=Math.max(spec.grow||0,16);
    // Morphological features must remain visible in every action, including hurt and faint.
    for(const part of [...(spec.parts||[]),...(spec.erase||[])])delete part.anims;
  }
  const recolor=direct?(r,g,b)=>[r,g,b]:R.colourMap(R.pairOffsets(R.clusters(R.gifHistogram(R.gifOf(base)),R.K),R.clusters(R.gifHistogram(R.gifOf(p)),R.K)),R.manualMap(p.id));
  const native={},anims={};
  for(const name of ACTIONS){
    const a=resolve(dir,data,name);if(!a)throw Error(p.id+' missing '+name);
    let im=R.recolourSheet(a.file,recolor);const cell={fw:a.fw,fh:a.fh,frames:im.w/a.fw,rows:im.h/a.fh};
    if(spec)im=R.applyParts(R.growSheet(im,cell,spec.grow),spec,cell,R.readOffsets(sc,a.name,cell),name);
    const grow=spec?.grow||0;
    native[name]=im;anims[name]={fw:(a.fw+2*grow)*2,fh:(a.fh+2*grow)*2,frames:cell.frames,rows:cell.rows,durations:a.durations,hit:a.hit,rush:a.rush,ret:a.ret,sourceAnimation:a.name,substituted:a.name!==name};
  }
  const reduction=limitPalette(native),shiny=Object.fromEntries(Object.entries(native).map(([n,im])=>[n,copy(im)]));
  const shinyInfo=shinyMap(input,native,p.id);remap(shiny,(...c)=>shinyInfo.map[hex(c)]);limitPalette(shiny);
  let dedicatedShiny=null;
  if(['0007_squirtle','0008_wartortle'].includes(p.id)){
    dedicatedShiny=dex+'/0000/0001';
    const sd=path.join(ROOT,'.cache/SpriteCollab/sprite',dedicatedShiny),sa=SC.readAnimData(sd);
    for(const name of ACTIONS){const a=resolve(sd,sa,name);if(!a)throw Error('Missing dedicated shiny '+name);
      const im=P.decodePng(a.file),meta=anims[name];
      if(im.w!==native[name].w||im.h!==native[name].h||a.fw*2!==meta.fw||a.fh*2!==meta.fh||JSON.stringify(a.durations)!==JSON.stringify(meta.durations))throw Error('Shiny template layout differs: '+p.id+'/'+name);
      shiny[name]=im;
    }
    limitPalette(shiny);
    fs.copyFileSync(path.join(sd,'credits.txt'),path.join(dest,'credits-shiny.txt'));
    fs.copyFileSync(path.join(sd,'provenance.json'),path.join(dest,'provenance-shiny.json'));
  }
  const rec={id:p.id,name:p.name,src,dirs:DIRS,scale:2,shadowSize:data.shadowSize,method:direct?'PMD元素材':'基本種PMD＋形態パーツ',sourceFolder:sc,revision:REV,paletteReduction:reduction,variants:{},notes:[]};
  if(!direct)rec.notes.push('形態の特徴を基本種のポーズへ合成した試作品。種別専用の新規手描き全ポーズではありません。');
  if(dedicatedShiny){rec.shinySourceFolder=dedicatedShiny;rec.notes.push('色違いは甲羅と腹を分けた専用PMD素材を使用。作者情報はcredits-shiny.txtも参照。');}
  if(anims.Faint.sourceAnimation!=='Faint')rec.notes.push('Faintは'+anims.Faint.sourceAnimation+'を代用。');
  for(const[variant,sheets]of Object.entries({normal:native,shiny})){
    const va={anims:JSON.parse(JSON.stringify(anims)),palette:[...palette(sheets).keys()]};
    for(const[name,im]of Object.entries(sheets)){
      const big=G.newImg(im.w*2,im.h*2);G.blitScaled(big,im,0,0,im.w,im.h,0,0,2);
      const filename=name+(variant==='shiny'?'-shiny':'')+'.png';fs.writeFileSync(path.join(dest,filename),G.encodePng(big));
      va.anims[name].file=filename;
      if(name==='Idle')Object.assign(va,measure(big,va.anims[name]));
    }
    const foot=va.anchorY-va.anims.Idle.fh/2;for(const a of Object.values(va.anims))a.anchorY=a.fh/2+foot;
    rec.variants[variant]=va;
  }
  writeJSON(path.join(dest,'manifest.json'),rec);writeJSON(path.join(dest,'shiny-color-map.json'),shinyInfo);
  fs.copyFileSync(path.join(dir,'credits.txt'),path.join(dest,'credits.txt'));
  fs.copyFileSync(path.join(dir,'provenance.json'),path.join(dest,'provenance.json'));
  return rec;
}
fs.mkdirSync(OUT,{recursive:true});const records=[];
for(const p of selected){const r=buildEntry(p);records.push(r);console.log(p.id+' : 9 actions × normal/shiny; '+r.method);}
const catalog={version:1,generatedAt:new Date().toISOString(),dirs:DIRS,actions:ACTIONS,records};
writeJSON(path.join(OUT,'catalog.json'),catalog);fs.writeFileSync(path.join(OUT,'catalog.js'),'window.PMD_STUDY = '+JSON.stringify(catalog)+';\n');
const inventory=[];
for(const r of records){const input=path.join(ROOT,'pokeSprite',r.src);const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.(png|gif)$/i.test(e.name)){const relative=path.relative(input,f);inventory.push({id:r.id,input:path.join(r.src,relative),output:path.join(r.src,relative),sourceSha256:hash(fs.readFileSync(f))});}}};walk(input);}
writeJSON(path.join(OUT,'source-inventory.json'),inventory);
fs.copyFileSync(path.join(ROOT,'.cache/SpriteCollab/reference-metadata',REV,'LICENSE.md'),path.join(OUT,'LICENSE-SpriteCollab.md'));
fs.copyFileSync(path.join(ROOT,'.cache/SpriteCollab/reference-metadata',REV,'credit_names.txt'),path.join(OUT,'credit_names.txt'));
fs.copyFileSync(path.join(__dirname,'reference-study-debug.html'),path.join(OUT,'../PMD-Debug.html'));
console.log(`Generated ${records.length} forms / ${records.length*18} sheets; ${inventory.length} source images queued for matching PNG/GIF export.`);
