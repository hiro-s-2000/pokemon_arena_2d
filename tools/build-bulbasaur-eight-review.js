#!/usr/bin/env node
'use strict';
// Single-species review: actual PMD directional poses + source-matched palette.
// Source sprites and installed game sheets are read-only. No generated artwork/API.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const G=require('./build-gif-anim'),P=require('./pixelize');
const ROOT=path.resolve(__dirname,'..'),BASE=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review');
const OUT=path.join(BASE,'bulbasaur-eight-directions'),SRC=path.resolve(ROOT,'../確認用画像/reference-study/gen1/0001_bulbasaur/normal');
const DIRS=['S','SE','E','NE','N','NW','W','SW'],CELL=288,FOOT=180,NATIVE=96,ORIGIN=48,SCALE=4;
const BASELINE=fs.existsSync(path.join(BASE,'previous-gif-review/backup-info.json'))?path.join(BASE,'previous-gif-review'):BASE;
const OLD=JSON.parse(fs.readFileSync(path.join(SRC,'manifest.json'))).variants.normal.anims;
const PREVIOUS=JSON.parse(fs.readFileSync(path.join(BASELINE,'0001_bulbasaur/manifest.json')));
const ACTIONS={Idle:{frames:60,ticks:2,loop:true},Walk:{frames:48,ticks:1,loop:true},Attack:{frames:36,ticks:1,loop:false},Hurt:{frames:24,ticks:1,loop:false},Faint:{frames:48,ticks:1,loop:false}};
// Explicit semantic colour ramps sampled from pokeSprite/front.png, not automatic hue swapping.
const MAP={'000000':'101010','96d3c7':'62d5b4','5d9890':'399494','3c5951':'184a4a','426f21':'526229','579d2d':'73ac31','7cc44d':'a4d541','d0e8a0':'bdff73','9f0000':'ac0031','ff7072':'ff6a62','50616f':'317373','ffffff':'ffffff'};
const rgb=h=>h.match(/../g).map(s=>parseInt(s,16));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources=['manifest.json','credits.txt','provenance.json',...Object.keys(ACTIONS).map(n=>n+'.png')].map(f=>({file:f,sha256:hash(fs.readFileSync(path.join(SRC,f)))}));
const rgba=d=>(d[0]<<24|d[1]<<16|d[2]<<8|d[3])>>>0;
const lookup=new Map(Object.entries(MAP).map(([a,b])=>[rgba([...rgb(a),255]),rgb(b)]));
function bbox(im){let x0=im.w,y0=im.h,x1=-1,y1=-1,sumX=0,sumY=0,count=0;for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)if(im.data[(y*im.w+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);sumX+=x;sumY+=y;count++}if(x1<0)throw Error('empty image');return {x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1,cx:sumX/count,cy:sumY/count};}
function pixel(im,x,y){if(x<0||y<0||x>=im.w||y>=im.h)return 0;return rgba(im.data.subarray((y*im.w+x)*4,(y*im.w+x+1)*4));}
function extract(sheet,a,row,k){const im=G.newImg(NATIVE,NATIVE);for(let y=0;y<a.fh;y+=2)for(let x=0;x<a.fw;x+=2){const si=((row*a.fh+y)*sheet.w+k*a.fw+x)*4;if(!sheet.data[si+3])continue;const dx=ORIGIN+(x-a.fw/2)/2,dy=ORIGIN+(y-a.anchorY)/2;if(dx<0||dy<0||dx>=NATIVE||dy>=NATIVE)throw Error('Native bounds');const di=(dy*NATIVE+dx)*4,col=lookup.get(rgba(sheet.data.subarray(si,si+4)))||Array.from(sheet.data.subarray(si,si+3));im.data.set([...col,255],di);}im.box=bbox(im);return im;}
// Scale2x edge rules retain exact palette, remove some enlarged staircase corners,
// and do NOT invent face detail. Intermediate raster stays fully opaque/transparent.
function scale2x(im){const out=G.newImg(im.w*2,im.h*2);for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const E=pixel(im,x,y),B=pixel(im,x,y-1),D=pixel(im,x-1,y),F=pixel(im,x+1,y),H=pixel(im,x,y+1);let v=[E,E,E,E];if(B!==H&&D!==F)v=[D===B?D:E,B===F?F:E,D===H?D:E,H===F?F:E];for(let k=0;k<4;k++){const q=v[k],i=((y*2+(k>>1))*out.w+x*2+k%2)*4;out.data[i]=q>>>24;out.data[i+1]=(q>>>16)&255;out.data[i+2]=(q>>>8)&255;out.data[i+3]=q&255;}}return out;}
function patchCost(a,b,x,y,u,v){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const A=pixel(a,x+dx,y+dy),B=pixel(b,u+dx,v+dy);if(!A&&!B)continue;if(!A||!B){sum+=3;continue}sum+=(Math.abs((A>>>24)-(B>>>24))+Math.abs(((A>>>16)&255)-((B>>>16)&255))+Math.abs(((A>>>8)&255)-((B>>>8)&255)))/255;}return sum;}
// Low-resolution block matching around global body displacement. Only used to
// warp the adjacent actual pose; no alpha crossfade or translucent double image.
function flow(a,b){const dx=Math.round(b.box.cx-a.box.cx),dy=Math.round(b.box.cy-a.box.cy),w=NATIVE/2+1,fx=new Float32Array(w*w).fill(dx),fy=new Float32Array(w*w).fill(dy);
for(let gy=0;gy<w;gy++)for(let gx=0;gx<w;gx++){const x=gx*2,y=gy*2;if(x<a.box.x0-3||x>a.box.x1+3||y<a.box.y0-3||y>a.box.y1+3)continue;let score=Infinity,bx=dx,by=dy;for(let oy=-3;oy<=3;oy++)for(let ox=-3;ox<=3;ox++){const u=x+dx+ox,v=y+dy+oy,cost=patchCost(a,b,x,y,u,v)+.065*(ox*ox+oy*oy);if(cost<score){score=cost;bx=dx+ox;by=dy+oy}}fx[gy*w+gx]=bx;fy[gy*w+gx]=by;}
// Smooth local displacement to avoid tearing contours between neighbouring blocks.
for(let pass=0;pass<2;pass++)for(const field of [fx,fy]){const src=field.slice();for(let y=1;y<w-1;y++)for(let x=1;x<w-1;x++){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=src[(y+dy)*w+x+dx]*(dy===0?2:1)*(dx===0?2:1);field[y*w+x]=sum/16;}}
return {w,fx,fy};}
function sampleFlow(f,x,y){x=Math.max(0,Math.min(NATIVE-.01,x))/2;y=Math.max(0,Math.min(NATIVE-.01,y))/2;const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;const get=a=>a[iy*f.w+ix]*(1-tx)*(1-ty)+a[iy*f.w+ix+1]*tx*(1-ty)+a[(iy+1)*f.w+ix]*(1-tx)*ty+a[(iy+1)*f.w+ix+1]*tx*ty;return [get(f.fx),get(f.fy)];}
function render(a,b,f,amount){const im=G.newImg(CELL,CELL),big=a.big;for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){const tx=(x-CELL/2)/SCALE+ORIGIN,ty=(y-FOOT)/SCALE+ORIGIN;let u=tx,v=ty;for(let iter=0;iter<2;iter++){const [dx,dy]=sampleFlow(f,u,v);u=tx-dx*amount;v=ty-dy*amount}const sx=Math.round(u*2),sy=Math.round(v*2);if(sx<0||sy<0||sx>=big.w||sy>=big.h)continue;const si=(sy*big.w+sx)*4;if(!big.data[si+3])continue;im.data.set(big.data.subarray(si,si+4),(y*CELL+x)*4);}return im;}
function timeline(a,name){let frames=Array.from({length:a.frames},(_,i)=>i),weights=[...a.durations];
// Hurt returns to idle; Faint starts from standing, then retains the authored
// faint poses (closed eyes), instead of rotating a standing cutout.
if(name==='Faint'){frames=[-1,...frames];weights=[8,...weights];}
if(name==='Hurt'){frames=[-1,...frames,-1];weights=[2,...weights,3];}
if(!ACTIONS[name].loop&&name==='Attack'){frames.push(-1);weights.push(4);}
return {frames,weights,total:weights.reduce((a,b)=>a+b,0)};}
function position(tl,p,loop){let time=p*tl.total,start=0;for(let i=0;i<tl.frames.length;i++){const end=start+tl.weights[i];if(time<end||i===tl.frames.length-1){let next=i+1;if(next===tl.frames.length)next=loop?0:i;const t=Math.min(1,(time-start)/tl.weights[i]);return {from:tl.frames[i],to:tl.frames[next],t:t*t*(3-2*t),segment:i}}start=end;}}
fs.mkdirSync(OUT,{recursive:true});
const meta={id:'0001_bulbasaur',name:'フシギダネ',dirs:DIRS,fw:CELL,fh:CELL,anchorY:FOOT,scaleFromNative:SCALE,method:'PMD actual directional poses / semantic recolour / Scale2x / local motion warp',paletteMap:MAP,sources,previous:PREVIOUS.anims,anims:{},limitations:['8方向の形・目・足・つぼみの重なりはPMD素材由来です。pokeSpriteを新たに8方向描き起こしたものではありません。','色はpokeSpriteの顔・体・つぼみの色へ対応付けています。顔の細部はPMD素材の画素数が上限です。','コマ間は局所的な動き推定で変形補間します。遮蔽や急なポーズ変化では切り替わりが残ります。','倒れる動作はPMDの各方向の専用列を使用。ただし元素材の最終姿勢は複数方向で共通です。最終コマで停止します。ゲーム本体と残り8体は未変更です。']};
const idleSheet=P.decodePng(path.join(SRC,'Idle.png')),idle=DIRS.map((_,row)=>extract(idleSheet,OLD.Idle,row,0));idle.forEach(i=>i.big=scale2x(i));
const validation={passed:true,rows:[],sourceUnchanged:false,sourceDirectionHashes:idle.map(i=>hash(i.data))};
if(new Set(validation.sourceDirectionHashes).size!==8)throw Error('Idle directions are not distinct');
const contacts=G.newImg(CELL*8,32+5*(CELL+24));G.fill(contacts,0,0,contacts.w,contacts.h,[229,236,242]);G.bigText(contacts,12,9,'BULBASAUR / TRUE EIGHT FACING POSES / POKESPRITE COLORS',[30,48,60]);
let ai=0;
for(const [name,spec] of Object.entries(ACTIONS)){
const a=OLD[name],source=P.decodePng(path.join(SRC,name+'.png')),sheet=G.newImg(CELL*spec.frames,CELL*8),tl=timeline(a,name),rows=[];
for(let row=0;row<8;row++){
 const poses=Array.from({length:a.frames},(_,k)=>extract(source,a,row,k));poses.forEach(i=>i.big=scale2x(i));const get=k=>k<0?idle[row]:poses[k],flows=new Map(),unique=new Set(),steps=[];
 for(let k=0;k<spec.frames;k++){
  const p=k/(spec.loop?spec.frames:spec.frames-1),pos=position(tl,p,spec.loop),forward=pos.t<=.5,from=forward?pos.from:pos.to,to=forward?pos.to:pos.from,amount=forward?pos.t:1-pos.t,key=from+':'+to;
  if(!flows.has(key))flows.set(key,flow(get(from),get(to)));
  const im=render(get(from),get(to),flows.get(key),amount),b=bbox(im);
  if(b.x0<2||b.y0<2||b.x1>=CELL-2||b.y1>=CELL-2)throw Error(`Clipped ${name}/${row}/${k}`);
  unique.add(hash(im.data));steps.push({sourceFrom:pos.from,sourceTo:pos.to,blend:pos.t,bounds:b});G.blitScaled(sheet,im,0,0,CELL,CELL,k*CELL,row*CELL,1);
  if(k===(name==='Attack'?16:name==='Faint'?spec.frames-1:name==='Walk'?12:name==='Hurt'?6:0))G.blitScaled(contacts,im,0,0,CELL,CELL,row*CELL,32+ai*(CELL+24)+24,1);
 }
 rows.push({direction:DIRS[row],uniqueFrames:unique.size,steps});console.log(name+' '+DIRS[row]+': '+unique.size+'/'+spec.frames);
}
fs.writeFileSync(path.join(OUT,name+'.png'),G.encodePng(sheet));
meta.anims[name]={...spec,fw:CELL,fh:CELL,rows:8,file:name+'.png',anchorY:FOOT,durations:Array(spec.frames).fill(spec.ticks),originalFrames:a.frames,originalDurations:a.durations,hit:name==='Attack'?Math.round(a.durations.slice(0,a.hit).reduce((s,d)=>s+d,0)/tl.total*(spec.frames-1)):null};
validation.rows.push({action:name,rows});
for(let row=0;row<8;row++)G.bigText(contacts,row*CELL+10,32+ai*(CELL+24)+5,name.toUpperCase()+' '+DIRS[row],[30,48,60]);ai++;
}
fs.writeFileSync(path.join(OUT,'contact.png'),G.encodePng(contacts));
// Direct old/new direction comparison, aligned to the same foot position.
const compare=G.newImg(CELL*8,2*(CELL+28));G.fill(compare,0,0,compare.w,compare.h,[229,236,242]);
const old=P.decodePng(path.join(BASELINE,'0001_bulbasaur/Idle.png')),current=P.decodePng(path.join(OUT,'Idle.png'));
for(let r=0;r<8;r++){G.bigText(compare,r*CELL+10,8,'PREVIOUS '+DIRS[r],[30,48,60]);G.blitScaled(compare,old,0,r*192,192,192,r*CELL+(CELL-192)/2,28+FOOT-144,1);G.bigText(compare,r*CELL+10,CELL+36,'EIGHT DIR '+DIRS[r],[30,48,60]);G.blitScaled(compare,current,0,r*CELL,CELL,CELL,r*CELL,CELL+56,1);}
fs.writeFileSync(path.join(OUT,'comparison.png'),G.encodePng(compare));
for(const s of sources)if(hash(fs.readFileSync(path.join(SRC,s.file)))!==s.sha256)throw Error('Source modified');validation.sourceUnchanged=true;
fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(meta,null,2)+'\n');fs.writeFileSync(path.join(OUT,'manifest.js'),'window.EIGHT_REVIEW='+JSON.stringify(meta)+';\n');
fs.writeFileSync(path.join(OUT,'validation.json'),JSON.stringify(validation,null,2)+'\n');
for(const f of ['credits.txt','provenance.json'])fs.copyFileSync(path.join(SRC,f),path.join(OUT,f));
fs.copyFileSync(path.join(__dirname,'bulbasaur-eight-review.html'),path.join(OUT,'index.html'));
console.log('Review: '+path.join(OUT,'index.html'));
