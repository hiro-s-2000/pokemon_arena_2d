#!/usr/bin/env node
'use strict';
// Higher-detail form study: retains the actual entire source GIF, including wings,
// canopy and cannons. Eight projected views are explicitly NOT eight authored views.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const G=require('./build-gif-anim'),P=require('./pixelize'),{ACTIONS}=require('./eight-direction-engine');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review'),BACKUP=path.join(OUT,'form-pmd-v1');
const roster=JSON.parse(fs.readFileSync(path.join(ROOT,'pokeData/index.json'))).pokemon.filter(p=>p.dex<=9&&['mega','gigantamax'].includes(p.category));
const DIRS=['S','SE','E','NE','N','NW','W','SW'],CELL=320,FOOT=240,TAU=Math.PI*2;
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x)},hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n'),png=(f,v)=>fs.writeFileSync(f,G.encodePng(v));
// The diagonal views keep the source projection. Cardinal views use monotonic
// curved-surface warping; hidden faces/parts cannot be recovered from two GIFs.
const VIEWS=[{side:'front',yaw:32,flip:false},{side:'front',yaw:0,flip:true},{side:'front',yaw:-32,flip:true},{side:'back',yaw:0,flip:false},{side:'back',yaw:32,flip:false},{side:'back',yaw:0,flip:true},{side:'front',yaw:-32,flip:false},{side:'front',yaw:0,flip:false}];
function box(im){let x0=im.w,y0=im.h,x1=-1,y1=-1;for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)if(im.data[(y*im.w+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}if(x1<0)throw Error('Empty sprite');return {x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1};}
function load(f){const g=G.decodeGif(f);let x0=g.W,y0=g.H,x1=-1,y1=-1;for(const fr of g.frames){const b=box({w:g.W,h:g.H,data:fr.data});x0=Math.min(x0,b.x0);y0=Math.min(y0,b.y0);x1=Math.max(x1,b.x1);y1=Math.max(y1,b.y1)}g.box={x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1};g.total=g.frames.reduce((s,f)=>s+Math.max(1,f.delay),0);return g;}
function frameAt(g,phase){let t=((phase%1)+1)%1*g.total;for(let i=0;i<g.frames.length;i++){t-=Math.max(1,g.frames[i].delay);if(t<0)return i}return 0;}
function project(x,yaw){const a=yaw*Math.PI/180;return Math.cos(a)*x+Math.sin(a)*.18*(Math.cos(Math.PI*x)-.65);}
function inverseTable(yaw){const lut=new Float32Array(4097);for(let i=0;i<=4096;i++){const target=i/4096*2-1;let lo=-1.5,hi=1.5;for(let j=0;j<20;j++){const mid=(lo+hi)/2;if(project(mid,yaw)<target)lo=mid;else hi=mid}lut[i]=(lo+hi)/2;}return lut;}
const TABLES=VIEWS.map(v=>inverseTable(v.yaw));
function movement(name,t,row){const angle=row*TAU/8,vx=Math.sin(angle),vy=Math.cos(angle);let dx=0,dy=0,rot=0,sx=1,sy=1,gait=0;
if(name==='Walk'){gait=Math.sin(TAU*t);dy=-2.2*(1-Math.cos(TAU*t*2));rot=.012*Math.sin(TAU*t);}
if(name==='Attack'){const wind=ease(t/.22)*(1-ease((t-.23)/.18)),strike=ease((t-.25)/.17)*(1-ease((t-.5)/.43));dx=vx*(28*strike-6*wind);dy=vy*(20*strike-5*wind)-4*strike;rot=-vx*.09*strike;sy=1-.045*wind;}
if(name==='Hurt'){const hit=ease(t/.13)*(1-ease((t-.25)/.75));dx=-vx*14*hit;dy=-vy*10*hit-3*Math.sin(Math.PI*t);rot=vx*.1*hit;}
if(name==='Faint'){const fall=ease((t-.15)/.7);rot=(row<=4?1:-1)*Math.PI*.44*fall;sy=1-.14*fall;dy=-3*Math.sin(Math.PI*clamp(t/.2))*(1-fall);}
return {dx,dy,rot,sx,sy,gait};}
function render(g,view,row,name,k,scale,calibrationFlip){const a=ACTIONS[name],t=k/(a.loop?a.frames:a.frames-1),phase=name==='Faint'||name==='Hurt'?0:name==='Attack'?.2*Math.sin(Math.PI*t):t;const index=frameAt(g,phase),source=g.frames[index],b=g.box,m=movement(name,t,row),c=Math.cos(m.rot),s=Math.sin(m.rot),w=b.w*scale,h=b.h*scale,flip=view.flip!==calibrationFlip;
const rotatedBottom=(Math.abs(s)*w*m.sx+Math.abs(c)*h*m.sy)/2,ox=CELL/2+m.dx,oy=FOOT-(name==='Faint'?rotatedBottom:h/2)+m.dy;
const im=G.newImg(CELL,CELL),lut=TABLES[row],yawSin=Math.sin(view.yaw*Math.PI/180);
for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
 const X=x-ox,Y=y-oy;let u=(c*X+s*Y)/(scale*m.sx),v=(-s*X+c*Y)/(scale*m.sy);if(flip)u=-u;
 const normalized=u/b.w;if(normalized<-.8||normalized>.8)continue;
 const q=lut[Math.max(0,Math.min(4096,Math.round((normalized+1)*2048)))];let sx=(b.x0+b.x1)/2+q*b.w,sy=(b.y0+b.y1)/2+v-yawSin*q*b.h*.065;
 if(name==='Walk'){const leg=ease((sy-(b.y0+b.h*.72))/(b.h*.24)),side=Math.tanh((sx-(b.x0+b.x1)/2)/(b.w*.13));sx-=m.gait*side*leg*1.25;sy+=m.gait*side*leg*.9;}
 sx=Math.round(sx);sy=Math.round(sy);if(sx<0||sy<0||sx>=g.W||sy>=g.H)continue;const src=(sy*g.W+sx)*4;if(!source.data[src+3])continue;im.data.set(source.data.subarray(src,src+4),(y*CELL+x)*4);
}return {im,index};}
function build(p){const dir=path.join(ROOT,path.dirname(p.sprite.replace('../',''))),dest=path.join(OUT,p.id),prior=JSON.parse(fs.readFileSync(path.join(BACKUP,p.id,'manifest.json')));const gifs={front:load(path.join(dir,'front.gif')),back:load(path.join(dir,'back.gif'))};
// GIF facings were inspected directly; the static PNGs can use different poses.
const swap=false;
const target=p.category==='gigantamax'?194:180,scale=target/Math.max(...Object.values(gifs).flatMap(g=>[g.box.w,g.box.h]));
const sources=['front.gif','back.gif'].map(f=>({file:path.relative(ROOT,path.join(dir,f)),sha256:hash(fs.readFileSync(path.join(dir,f)))}));
const meta={...prior,buildVersion:'form-reference-v2',sourceMode:'source-detail',sourceMethod:'pokeSprite全身画素＋8方向投影近似',fw:CELL,fh:CELL,anchorY:FOOT,scaleFromNative:scale,paletteMap:{},sources,anims:{},directionSources:VIEWS.map((v,i)=>({direction:DIRS[i],source:swap?(v.side==='front'?'back.gif':'front.gif'):v.side+'.gif',yaw:v.yaw,mirrored:swap?!v.flip:v.flip,quality:v.yaw===0?'source-view-or-mirror':'projected-approximation'})),pmdVariant:{...prior,anims:Object.fromEntries(Object.entries(prior.anims).map(([n,a])=>[n,{...a,file:'../form-pmd-v1/'+p.id+'/'+a.file}]))},limitations:['元GIFの全身の輪郭・色・顔・翼・花・砲塔を直接使用し、基本種の体型へ置き換えません。','正面／背面と反転を基に8方向へ投影した近似です。元絵にない角度や隠れた部位を正確に描き起こしたものではありません。','動作は元GIF＋部分変形・移動・回転です。専用ポーズを持つ前回PMD版へ切り替えて比較できます。','倒れる動作でも目の表情は元絵のままです。新しい表情の描き足しは行っていません。']};
const validation={passed:true,id:p.id,sourceHashesUnchanged:false,rows:[],idleDirectionHashes:[],mode:'source-detail-projection'};
let nativeColors=new Set();for(const g of Object.values(gifs))for(const f of g.frames)for(let i=0;i<f.data.length;i+=4)if(f.data[i+3])nativeColors.add(Buffer.from(f.data.subarray(i,i+3)).toString('hex'));
for(const [name,a]of Object.entries(ACTIONS)){const sheet=G.newImg(CELL*a.frames,CELL*8),rows=[];for(let row=0;row<8;row++){const v=VIEWS[row],g=gifs[swap?(v.side==='front'?'back':'front'):v.side],unique=new Set(),bounds=[],sourceFrames=[];for(let k=0;k<a.frames;k++){const {im,index}=render(g,v,row,name,k,scale,swap),b=box(im);if(b.x0<2||b.y0<2||b.x1>=CELL-2||b.y1>=CELL-2)throw Error(`Clipped ${p.id}/${name}/${row}/${k} ${JSON.stringify(b)}`);bounds.push(b);sourceFrames.push(index);unique.add(hash(im.data));if(name==='Idle'&&k===0)validation.idleDirectionHashes.push(hash(im.data));G.blitScaled(sheet,im,0,0,CELL,CELL,k*CELL,row*CELL,1);}rows.push({direction:DIRS[row],uniqueFrames:unique.size,bounds,sourceFrames});}
 png(path.join(dest,name+'.png'),sheet);meta.anims[name]={...a,file:name+'.png',fw:CELL,fh:CELL,rows:8,anchorY:FOOT,durations:Array(a.frames).fill(a.ticks),originalFrames:gifs.front.frames.length,sourceRows:2,sourceAnimation:'source GIF + projected mesh',hit:name==='Attack'?16:null};validation.rows.push({action:name,rows});console.log(p.id+' '+name+' / unique '+rows.map(r=>r.uniqueFrames).join(','));}
meta.nativeColorCount=nativeColors.size;meta.nativeSourceSizes=Object.fromEntries(Object.entries(gifs).map(([n,g])=>[n,{width:g.W,height:g.H,body:g.box,frames:g.frames.length}]));
const directions=G.newImg(CELL*8,CELL+24),contact=G.newImg(CELL*8,32+5*(CELL+24));for(const im of [directions,contact])G.fill(im,0,0,im.w,im.h,[229,236,242]);G.bigText(contact,10,8,p.id.toUpperCase()+' SOURCE DETAIL',[25,42,59]);
let ai=0;for(const [name,a]of Object.entries(meta.anims)){const im=P.decodePng(path.join(dest,name+'.png')),k=name==='Walk'?12:name==='Attack'?16:name==='Hurt'?6:name==='Faint'?47:0;for(let row=0;row<8;row++){const y=32+ai*(CELL+24);G.bigText(contact,row*CELL+8,y+4,name.toUpperCase()+' '+DIRS[row],[25,42,59]);G.blitScaled(contact,im,k*CELL,row*CELL,CELL,CELL,row*CELL,y+24,1);if(name==='Idle'){G.bigText(directions,row*CELL+8,4,DIRS[row]+(VIEWS[row].yaw?' APPROX':' SOURCE'),[25,42,59]);G.blitScaled(directions,im,0,row*CELL,CELL,CELL,row*CELL,24,1);}}ai++;}
png(path.join(dest,'contact.png'),contact);png(path.join(dest,'directions.png'),directions);
const idle=P.decodePng(path.join(dest,'Idle.png')),thumb=G.newImg(CELL,CELL);G.blitScaled(thumb,idle,0,7*CELL,CELL,CELL,0,0,1);png(path.join(dest,'thumbnail.png'),thumb);
const comparison=G.newImg(960,380);G.fill(comparison,0,0,960,380,[229,236,242]);for(const [i,label]of ['SOURCE GIF','PREVIOUS PMD','NEW SOURCE DETAIL'].entries())G.bigText(comparison,i*320+10,12,label,[25,42,59]);
const g=gifs.front,b=g.box,source={w:g.W,h:g.H,data:g.frames[0].data},fit=194/Math.max(b.w,b.h);G.blitScaled(comparison,source,b.x0,b.y0,b.w,b.h,Math.round((320-b.w*fit)/2),Math.round(70+(220-b.h*fit)/2),fit);
const old=P.decodePng(path.join(BACKUP,p.id,'Idle.png')),oa=prior.anims.Idle;G.blitScaled(comparison,old,0,7*oa.fh,oa.fw,oa.fh,320+(320-oa.fw)/2,50,1);G.blitScaled(comparison,idle,0,7*CELL,CELL,CELL,640,40,1);png(path.join(dest,'quality-comparison.png'),comparison);
for(const s of sources)if(s.sha256!==hash(fs.readFileSync(path.resolve(ROOT,s.file))))throw Error('Input modified');validation.sourceHashesUnchanged=true;
json(path.join(dest,'manifest.json'),meta);json(path.join(dest,'validation.json'),validation);console.log('DONE '+p.id+' native colours '+nativeColors.size+' scale '+scale.toFixed(2));
}
if(require.main===module){const idx=process.argv.indexOf('--id'),id=idx<0?null:process.argv[idx+1];const list=id?roster.filter(p=>p.id===id):roster;if(!list.length)throw Error('Unknown form');for(const p of list){if(process.argv.includes('--resume')){const m=JSON.parse(fs.readFileSync(path.join(OUT,p.id,'manifest.json')));if(m.buildVersion==='form-reference-v2'){console.log('SKIP '+p.id);continue}}build(p);}}
module.exports={build};
