'use strict';
const fs=require('fs'),path=require('path'),G=require('./build-gif-anim'),old=require('./pmd-form-detail-art');
const ROOT=path.resolve(__dirname,'..'),roster=JSON.parse(fs.readFileSync(path.join(ROOT,'pokeData/index.json'))).pokemon,cache=new Map();
function inside(x,y,p){let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!=(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])hit=!hit;return hit;}
function load(id,back,part){const key=id+back+part;if(cache.has(key))return cache.get(key);const p=roster.find(p=>p.id===id),file=path.join(ROOT,path.dirname(p.sprite.replace('../','')),back?'back.gif':'front.gif'),g=G.decodeGif(file),im=G.newImg(g.W,g.H),src=g.frames[0].data;let minX=g.W,minY=g.H,maxX=0,maxY=0;
for(let y=0;y<g.H;y++)for(let x=0;x<g.W;x++){const i=(y*g.W+x)*4;if(!src[i+3])continue;const [r,bg,b]=src.subarray(i,i+3);let keep=false;
if(part==='plant'){if(id.endsWith('gmax'))keep=back?(y<g.H*.61||inside(x,y,[[0,35],[31,35],[33,73],[10,76]])||inside(x,y,[[70,37],[g.W,37],[g.W,81],[75,74]])):(y<48||inside(x,y,[[3,42],[25,42],[28,66],[10,70]])||inside(x,y,[[76,42],[111,42],[111,85],[84,81],[69,60]]));else keep=y<g.H*.52;}
if(part==='shell'){keep=id.endsWith('gmax')?inside(x,y,[[3,0],[76,0],[83,23],[79,44],[71,53],[55,62],[45,73],[18,80],[4,69],[0,53]]):inside(x,y,[[16,0],[79,0],[79,13],[43,18],[52,25],[54,43],[43,65],[19,64],[7,53],[10,24]]);}
if(part==='flame')keep=y<g.H*.59&&r>180&&bg>65&&bg<r*.98&&b<bg*.72;
if(part==='wing')keep=inside(x,y,back?[[2,2],[g.W*.68,1],[g.W*.57,g.H*.28],[g.W*.70,g.H*.56],[g.W*.3,g.H*.58],[2,g.H*.75]]:[[g.W*.7,0],[g.W,3],[g.W,g.H*.84],[g.W*.79,g.H*.63],[g.W*.69,g.H*.25]]);
if(part==='arm')keep=inside(x,y,[[0,g.H*.5],[g.W*.37,g.H*.5],[g.W*.37,g.H*.76],[0,g.H*.76]]);

if(part==='shell'&&b>r*1.2&&b>bg*1.05)keep=false;
if(keep){im.data.set(src.subarray(i,i+4),i);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
const crop=G.newImg(maxX-minX+1,maxY-minY+1);G.blitScaled(crop,im,minX,minY,crop.w,crop.h,0,0,1);cache.set(key,crop);return crop;}
function put(dst,src,cx,bottom,width,flip=false,skew=0){const scale=width/src.w,h=Math.round(src.h*scale),w=Math.round(width);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(src.w-1,Math.floor((flip?w-1-x:x)/scale)),sy=Math.min(src.h-1,Math.floor(y/scale)),i=(sy*src.w+sx)*4;if(!src.data[i+3])continue;const xx=Math.round(cx-w/2+x+skew*(y/h-.5)),yy=Math.round(bottom-h+y);if(xx>=0&&yy>=0&&xx<dst.w&&yy<dst.h)dst.data.set(src.data.subarray(i,i+4),(yy*dst.w+xx)*4);}}
function blit(d,s){G.blitScaled(d,s,0,0,s.w,s.h,0,0,1);}
function compose(raw,body,ctx){const {id,row,anchors:a}=ctx,c=a.center,h=a.head,back=[3,4,5].includes(row),flip=[1,2,3].includes(row),side=[2,6].includes(row),ven=id.startsWith('0003'),blast=id.startsWith('0009'),xform=id.endsWith('-x'),giant=id.endsWith('gmax');const im=G.newImg(body.w,body.h);
// Remove only native form-specific parts; retain articulated face, torso and limbs.
const keepSet=new Set(ven?['87afcf','67879f','3f576f']:blast?['373f8f','4f5f97','6787af','ffe79f','dfaf67','ffffff']:[]);
for(let y=0;y<body.h;y++)for(let x=0;x<body.w;x++){const i=(y*body.w+x)*4;if(!raw.data[i+3])continue;const col=Buffer.from(raw.data.subarray(i,i+3)).toString('hex');let erase=false;if(ven||blast){erase=!keepSet.has(col);if(col==='000000'){erase=true;for(let dy=-3;dy<=3&&erase;dy++)for(let dx=-3;dx<=3;dx++){const j=((y+dy)*raw.w+x+dx)*4;if(j>=0&&j+3<raw.data.length&&raw.data[j+3]&&keepSet.has(Buffer.from(raw.data.subarray(j,j+3)).toString('hex'))){erase=false;break;}}}}if(!ven&&!blast&&!xform){const torso=((x-c[0])/25)**2+((y-c[1])/36)**2<1,head=((x-h[0])/24)**2+((y-h[1])/25)**2<1,hands=[a.handL,a.handR].some(q=>Math.abs(x-q[0])<11&&Math.abs(y-q[1])<11);erase=col==='373f8f'||(!torso&&!head&&!hands&&y<c[1]+4);}if(ven&&['ffffff','9f0000'].includes(col)&&((x-h[0])/21)**2+((y-h[1])/12)**2<1)erase=false;if(blast&&col==='ffffff'&&y<c[1]-12&&Math.abs(x-h[0])>15)erase=true;if(erase)body.data[i+3]=0;}
if(ven){old.ellipse(im,[c[0],c[1]+18],32,22,'24a99a','172129');old.ellipse(im,[c[0]-3,c[1]+14],26,15,'62c8b7',null);blit(im,body);const plant=load(id,back,'plant');put(im,plant,c[0],c[1]+(giant?(back?28:51):(back?10:23)),giant?(side?99:114):(side?97:108),flip,side?(flip?7:-7):0);
for(let y=0;y<body.h;y++)for(let x=0;x<body.w;x++){const i=(y*body.w+x)*4;if(!body.data[i+3])continue;const face=((x-h[0])/22)**2+((y-h[1])/13)**2<1;if((!back&&face)||y>a.bottom[1]-6)im.data.set(body.data.subarray(i,i+4),i);}
// Forehead flower is distinct from the large canopy.
if(!giant&&!back){const f=G.newImg(19,15);old.poly(f,[[9,0],[12,4],[18,3],[15,8],[17,12],[11,11],[8,14],[6,10],[0,10],[4,6],[1,2],[7,3]],'ff8e98','b6495c');put(im,f,h[0],h[1]-10,20,flip);}}
else if(blast){const shell=load(id,true,'shell'),width=giant?(side?85:96):(side?64:73),bottom=c[1]+(giant?29:23);put(im,shell,c[0]+(side?(flip?-7:7):0),bottom,width,flip,side?(flip?-9:9):0);if(!back)blit(im,body);else{const shellLayer=im;const out=G.newImg(im.w,im.h);blit(out,body);blit(out,shellLayer);im.data.set(out.data);}
if(!giant&&!back){const arm=load(id,false,'arm');for(const q of [a.handL,a.handR])put(im,arm,q[0],q[1]+10,24,q===a.handR);} }
else if(xform){blit(im,body);}
else {if(giant){const fire=load(id,back,'flame');put(im,fire,c[0],c[1]+3,side?83:112,flip);}else {const wing=load(id,false,'wing');for(const s of [-1,1])put(im,wing,c[0]+s*(side?14:26),c[1]+9,side?29:45,s<0);}blit(im,body);if(giant){ // Restore the bright belly pattern inside the existing articulated belly.
for(let y=0;y<body.h;y++)for(let x=0;x<body.w;x++){const i=(y*body.w+x)*4;if(body.data[i+3]&&body.data[i]>180&&body.data[i+1]>145&&body.data[i+2]>65&&y>c[1]){im.data.set([255,238,154,255],i);if((x*3+y)%19<2)im.data.set([255,166,35,255],i);}}}}
return im;}
function palette(id){const p=old.palette(id);if(id.startsWith('0003'))Object.assign(p,{'87afcf':'62c8b7','67879f':'24a99a','3f576f':'08766b'});if(id==='0006_charizard-gmax')Object.assign(p,{'d73f00':'ed722c','9f0000':'b84220','ff875f':'ffb547'});return p;}
module.exports={compose,palette,load};
