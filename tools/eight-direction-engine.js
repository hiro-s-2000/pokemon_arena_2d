'use strict';
// Reusable engine extracted from the approved Bulbasaur prototype.
const G=require('./build-gif-anim');
const ACTIONS={Idle:{frames:60,ticks:2,loop:true},Walk:{frames:48,ticks:1,loop:true},Attack:{frames:36,ticks:1,loop:false},Hurt:{frames:24,ticks:1,loop:false},Faint:{frames:48,ticks:1,loop:false}};
const rgba=d=>(d[0]<<24|d[1]<<16|d[2]<<8|d[3])>>>0;
const rgb=h=>h.match(/../g).map(s=>parseInt(s,16));
function createEngine({cell=288,foot=180,native=192,scale=3,sourceScale=2,palette={}}={}) {
const CELL=cell,FOOT=foot,NATIVE=native,ORIGIN=native/2,SCALE=scale,SOURCE_SCALE=sourceScale;
const lookup=new Map(Object.entries(palette).map(([a,b])=>[rgba([...rgb(a),255]),rgb(b)]));
function bbox(im){let x0=im.w,y0=im.h,x1=-1,y1=-1,sumX=0,sumY=0,count=0;for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)if(im.data[(y*im.w+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);sumX+=x;sumY+=y;count++}if(x1<0)throw Error('empty image');return {x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1,cx:sumX/count,cy:sumY/count};}
function pixel(im,x,y){if(x<0||y<0||x>=im.w||y>=im.h)return 0;return rgba(im.data.subarray((y*im.w+x)*4,(y*im.w+x+1)*4));}
function extract(sheet,a,row,k){const im=G.newImg(NATIVE,NATIVE);for(let y=0;y<a.fh;y+=SOURCE_SCALE)for(let x=0;x<a.fw;x+=SOURCE_SCALE){const si=((row*a.fh+y)*sheet.w+k*a.fw+x)*4;if(!sheet.data[si+3])continue;const dx=Math.round(ORIGIN+(x-a.fw/2)/SOURCE_SCALE),dy=Math.round(ORIGIN+(y-a.anchorY)/SOURCE_SCALE);if(dx<0||dy<0||dx>=NATIVE||dy>=NATIVE)throw Error('Native bounds');const di=(dy*NATIVE+dx)*4,col=lookup.get(rgba(sheet.data.subarray(si,si+4)))||Array.from(sheet.data.subarray(si,si+3));im.data.set([...col,255],di);}im.box=bbox(im);return im;}
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
function render(a,b,f,amount){const im=G.newImg(CELL,CELL),big=a.big;
const x0=Math.max(0,Math.floor((Math.min(a.box.x0,b.box.x0)-ORIGIN-5)*SCALE+CELL/2)),x1=Math.min(CELL,Math.ceil((Math.max(a.box.x1,b.box.x1)-ORIGIN+6)*SCALE+CELL/2));
const y0=Math.max(0,Math.floor((Math.min(a.box.y0,b.box.y0)-ORIGIN-5)*SCALE+FOOT)),y1=Math.min(CELL,Math.ceil((Math.max(a.box.y1,b.box.y1)-ORIGIN+6)*SCALE+FOOT));
for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const tx=(x-CELL/2)/SCALE+ORIGIN,ty=(y-FOOT)/SCALE+ORIGIN;let u=tx,v=ty;for(let iter=0;iter<2;iter++){const [dx,dy]=sampleFlow(f,u,v);u=tx-dx*amount;v=ty-dy*amount}const sx=Math.round(u*2),sy=Math.round(v*2);if(sx<0||sy<0||sx>=big.w||sy>=big.h)continue;const si=(sy*big.w+sx)*4;if(!big.data[si+3])continue;im.data.set(big.data.subarray(si,si+4),(y*CELL+x)*4);}return im;}
function timeline(a,name){let frames=Array.from({length:a.frames},(_,i)=>i),weights=[...a.durations];
// Hurt returns to idle; Faint starts from standing, then retains the authored
// faint poses (closed eyes), instead of rotating a standing cutout.
if(name==='Faint'){frames=[-1,...frames];weights=[8,...weights];}
if(name==='Hurt'){frames=[-1,...frames,-1];weights=[2,...weights,3];}
if(!ACTIONS[name].loop&&name==='Attack'){frames.push(-1);weights.push(4);}
return {frames,weights,total:weights.reduce((a,b)=>a+b,0)};}
function position(tl,p,loop){let time=p*tl.total,start=0;for(let i=0;i<tl.frames.length;i++){const end=start+tl.weights[i];if(time<end||i===tl.frames.length-1){let next=i+1;if(next===tl.frames.length)next=loop?0:i;const t=Math.min(1,(time-start)/tl.weights[i]);return {from:tl.frames[i],to:tl.frames[next],t:t*t*(3-2*t),segment:i}}start=end;}}

return {bbox,extract,scale2x,flow,render,timeline,position};
}
module.exports={createEngine,ACTIONS};
