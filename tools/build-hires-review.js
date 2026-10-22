#!/usr/bin/env node
// Review-only, full-colour pokeSprite animation. Reuses the existing GIF/PNG codecs.
// No writes to pokeSprite, pokeAnim, or previous review assets. No generative API.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const G=require('./build-gif-anim'),P=require('./pixelize');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review');
const IDS=['0001_bulbasaur','0002_ivysaur','0003_venusaur','0004_charmander','0005_charmeleon','0006_charizard','0007_squirtle','0008_wartortle','0009_blastoise'];
const NAMES=['フシギダネ','フシギソウ','フシギバナ','ヒトカゲ','リザード','リザードン','ゼニガメ','カメール','カメックス'];
const DIRS=['S','SE','E','NE','N','NW','W','SW'];
// Deliberately the same source mapping as the existing builder, NOT eight drawn facings.
const SOURCES=[['front',false],['front',true],['front',true],['back',false],['back',true],['back',true],['front',false],['front',false]];
const ACTIONS={Idle:{frames:60,ticks:2,loop:true},Walk:{frames:48,ticks:1,loop:true},Attack:{frames:36,ticks:1,loop:false,hit:16},Hurt:{frames:24,ticks:1,loop:false},Faint:{frames:48,ticks:1,loop:false}};
const CELL=192,BASE=144,TAU=Math.PI*2;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const clamp=x=>Math.min(1,Math.max(0,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x)};
function box(d,w,h){let x0=w,y0=h,x1=-1,y1=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}return x1<0?null:{x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1};}
function load(file){const g=G.decodeGif(file);let x0=g.W,y0=g.H,x1=0,y1=0;for(const f of g.frames){const b=box(f.data,g.W,g.H);x0=Math.min(x0,b.x0);y0=Math.min(y0,b.y0);x1=Math.max(x1,b.x1);y1=Math.max(y1,b.y1)}g.box={x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1};g.duration=g.frames.reduce((a,f)=>a+Math.max(1,f.delay),0);return g;}
function gifAt(g,phase){let t=((phase%1)+1)%1*g.duration;for(let i=0;i<g.frames.length;i++){t-=Math.max(1,g.frames[i].delay);if(t<0)return i}return 0;}
function motion(name,t){let dx=0,dy=0,angle=0,sx=1,sy=1,gait=0;
 if(name==='Walk'){gait=Math.sin(TAU*t);dy=-1.6*(1-Math.cos(TAU*t*2));angle=0.018*Math.sin(TAU*t);}
 if(name==='Attack'){const wind=ease(t/.24)*(1-ease((t-.24)/.18)),lunge=ease((t-.24)/.20)*(1-ease((t-.49)/.45));dx=5*wind-20*lunge;dy=-3*lunge;sy=1-.055*wind;angle=.06*wind-.12*lunge;}
 if(name==='Hurt'){const hit=ease(t/.16)*(1-ease((t-.24)/.76));dx=11*hit;angle=.14*hit;dy=-4*Math.sin(Math.PI*t);}
 if(name==='Faint'){const fall=ease((t-.13)/.7);angle=.12*Math.sin(Math.PI*clamp(t/.30))-.5*Math.PI*fall;sy=1-.12*fall;dx=-4*fall;dy=-3*Math.sin(Math.PI*clamp(t/.30))*(1-fall);}
 return {dx,dy,angle,sx,sy,gait};}
function render(g,scale,name,k,n,flip){const t=k/(ACTIONS[name].loop?n:n-1),m=motion(name,t),phase=name==='Faint'||name==='Hurt'?0:name==='Attack'?.22*Math.sin(Math.PI*t):t;
 const sourceFrame=gifAt(g,phase),f=g.frames[sourceFrame],b=g.box,cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2;
 const c=Math.cos(m.angle),s=Math.sin(m.angle),w=b.w*scale,h=b.h*scale;
 // Rotation about body centre; preserve the resting foot baseline while falling.
 const bottom=(Math.abs(s)*w*m.sx+Math.abs(c)*h*m.sy)/2;
 const ox=CELL/2+m.dx,oy=BASE-(name==='Faint'?bottom:h/2)+m.dy;
 const out=G.newImg(CELL,CELL);
 for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
  const X=x-ox,Y=y-oy;let u=(c*X+s*Y)/(scale*m.sx)+cx,v=(-s*X+c*Y)/(scale*m.sy)+cy;
  // Feathered lower-body mesh, face/head left intact. This is a procedural gait,
  // not a claim that the source GIF contains actual walking/attack artwork.
  if(name==='Walk'){const leg=ease((v-(b.y0+b.h*.68))/(b.h*.27));const side=Math.tanh((u-cx)/(b.w*.12));u-=m.gait*side*leg*1.7;v+=m.gait*side*leg*1.15;}
  u=Math.round(u);v=Math.round(v);if(u<0||u>=g.W||v<0||v>=g.H)continue;
  const src=(v*g.W+u)*4;if(!f.data[src+3])continue;const dest=(y*CELL+(flip?CELL-1-x:x))*4;
  out.data[dest]=f.data[src];out.data[dest+1]=f.data[src+1];out.data[dest+2]=f.data[src+2];out.data[dest+3]=255;
 }
 return {img:out,sourceFrame};}
function png(file,img){fs.writeFileSync(file,G.encodePng(img));}
function copy(dst,src,x,y){G.blitScaled(dst,src,0,0,src.w,src.h,x,y,1);}
fs.mkdirSync(OUT,{recursive:true});
const catalog={version:1,method:'source-gif-nearest-neighbour-continuous-warp',cell:CELL,targetExtent:96,dirs:DIRS,directionSources:SOURCES,actions:ACTIONS,records:[],limitations:['拡大は元画素の保持であり、新しい顔の細部を描き足す処理ではありません。','8行は正面・背面とその反転による互換配置です。独立した8方向ではありません。','歩行は元GIF＋脚領域の変形、攻撃・被弾・倒れる動作は移動・回転・伸縮の補間です。','ゲーム未組み込み。通常色のみ。倒れた後も元画像の目の表情を保持します。']};
const report=[];
for(const [idx,id] of IDS.entries()){
 const dir=path.join(ROOT,'pokeSprite/gen1',id,'normal'),dest=path.join(OUT,id);fs.mkdirSync(dest,{recursive:true});
 const inputs=['front.gif','back.gif','front.png','box-icons/swsh.png'].filter(f=>fs.existsSync(path.join(dir,f)));
 const provenance=Object.fromEntries(inputs.map(f=>[f,hash(fs.readFileSync(path.join(dir,f)))]));
 const gifs={front:load(path.join(dir,'front.gif')),back:load(path.join(dir,'back.gif'))};
 const scale=96/Math.max(...Object.values(gifs).flatMap(g=>[g.box.w,g.box.h]));
 const prior=JSON.parse(fs.readFileSync(path.resolve(ROOT,'../確認用画像/reference-study/gen1',id,'normal/manifest.json'))).variants.normal.anims;
 const record={id,name:NAMES[idx],scale,source:inputs.map(f=>({file:f,sha256:provenance[f]})),sourceSize:Object.fromEntries(Object.entries(gifs).map(([k,g])=>[k,{width:g.W,height:g.H,body:g.box,frames:g.frames.length}])),anims:{},previous:prior};
 fs.copyFileSync(path.join(dir,'front.gif'),path.join(dest,'source.gif'));
 fs.copyFileSync(path.join(dir,'box-icons/swsh.png'),path.join(dest,'box-icon.png'));
 const contact=G.newImg(CELL*8,60+5*(CELL+24));G.fill(contact,0,0,contact.w,contact.h,[233,238,243]);G.bigText(contact,12,12,id.toUpperCase(),[26,42,57]);G.bigText(contact,12,32,'FULL SOURCE COLORS / 96PX EXTENT / PROCEDURAL MOTION',[60,78,94]);
 let ai=0;
 for(const [name,a] of Object.entries(ACTIONS)){
  const sheet=G.newImg(CELL*a.frames,CELL*8),rows=[];let frontFrames=[];
  for(let row=0;row<8;row++){
   const [source,flip]=SOURCES[row],unique=new Set(),sourceFrames=[],bounds=[];
   // Reuse identical mapped directions, documenting aliases in the manifest.
   const alias=SOURCES.findIndex(([s,f])=>s===source&&f===flip);
   if(alias<row){for(let y=0;y<CELL;y++)sheet.data.set(sheet.data.subarray(((alias*CELL+y)*sheet.w)*4,((alias*CELL+y+1)*sheet.w)*4),((row*CELL+y)*sheet.w)*4);rows.push({...rows[alias],direction:DIRS[row],aliasOf:DIRS[alias]});continue;}
   for(let k=0;k<a.frames;k++){
    const r=render(gifs[source],scale,name,k,a.frames,flip),b=box(r.img.data,CELL,CELL);
    if(!b||b.x0<2||b.y0<2||b.x1>=CELL-2||b.y1>=CELL-2)throw Error(`empty/clipped ${id}/${name}/${row}/${k}: ${JSON.stringify(b)}`);
    unique.add(hash(r.img.data));sourceFrames.push(r.sourceFrame);bounds.push(b);copy(sheet,r.img,k*CELL,row*CELL);
    if(row===0)frontFrames.push(r.img);
   }
   rows.push({direction:DIRS[row],uniqueFrames:unique.size,sourceFrames,bounds});
  }
  png(path.join(dest,name+'.png'),sheet);
  record.anims[name]={file:id+'/'+name+'.png',fw:CELL,fh:CELL,frames:a.frames,rows:8,durations:Array(a.frames).fill(a.ticks),loop:a.loop,hit:a.hit??null,anchorY:BASE,holdLast:name==='Faint',previousFrames:prior[name].frames};
  report.push({id,action:name,frames:a.frames,previousFrames:prior[name].frames,rows});
  const y=60+ai++*(CELL+24);G.bigText(contact,12,y,`${name.toUpperCase()} ${prior[name].frames} TO ${a.frames} FRAMES`,[26,42,57]);
  for(let q=0;q<8;q++){const k=Math.round(q*(a.frames-1)/7);copy(contact,frontFrames[k],q*CELL,y+24);G.bigText(contact,q*CELL+8,y+30,String(k+1),[100,115,130]);}
 }
 png(path.join(dest,'contact.png'),contact);
 const directions=G.newImg(CELL*8,CELL+24);G.fill(directions,0,0,directions.w,directions.h,[233,238,243]);
 for(let row=0;row<8;row++){const [s,f]=SOURCES[row];copy(directions,render(gifs[s],scale,'Idle',0,60,f).img,row*CELL,24);G.bigText(directions,row*CELL+8,5,DIRS[row]+' '+s.toUpperCase()+(f?' FLIP':''),[30,40,50]);}
 png(path.join(dest,'directions.png'),directions);
 fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(record,null,2)+'\n');catalog.records.push(record);
 for(const f of inputs)if(provenance[f]!==hash(fs.readFileSync(path.join(dir,f))))throw Error('Source changed '+f);
 console.log(`${id}: ${Math.round(scale*100)/100}x, 5 sheets, 1728 cells; front unique `+report.filter(r=>r.id===id).map(r=>r.action+':'+r.rows[0].uniqueFrames).join(', '));
}
fs.writeFileSync(path.join(OUT,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'catalog.js'),'window.SMOOTH_REVIEW='+JSON.stringify(catalog)+';\n');
fs.writeFileSync(path.join(OUT,'validation.json'),JSON.stringify({passed:true,sourceHashesUnchanged:true,transparent:true,noClipping:true,records:report},null,2)+'\n');
fs.copyFileSync(path.join(__dirname,'hires-review.html'),path.join(OUT,'index.html'));
const overview=G.newImg(CELL*4,40+IDS.length*(CELL+24));G.fill(overview,0,0,overview.w,overview.h,[233,238,243]);
['IDLE','WALK','ATTACK','FAINT'].forEach((s,i)=>G.bigText(overview,i*CELL+12,12,s,[30,44,60]));
for(const [row,id] of IDS.entries()){
 const y=40+row*(CELL+24);G.bigText(overview,12,y,id.toUpperCase(),[30,44,60]);
 for(const [col,[name,k]] of [['Idle',0],['Walk',12],['Attack',16],['Faint',47]].entries()){
  const im=P.decodePng(path.join(OUT,id,name+'.png'));G.blitScaled(overview,im,k*CELL,0,CELL,CELL,col*CELL,y+24,1);
 }
}
png(path.join(OUT,'overview.png'),overview);
console.log('Review: '+path.join(OUT,'index.html'));
