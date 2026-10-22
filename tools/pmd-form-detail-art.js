'use strict';
// Native pixel artwork for forms. Body/face/limbs are the actual PMD directional
// pose; new parts are rasterised on a 2x logical grid, with no anti-aliasing.
const G=require('./build-gif-anim');
const K='172129',WHITE='fff5dc';
const C={body:'53b9a6',bodyLight:'88d6bd',bodyDark:'287c72',leaf:'4b8e42',leafLight:'88bc50',leafDark:'275d35',pink:'ee8292',pinkLight:'ffb8bb',pinkDark:'b94868',pinkShade:'7e2c4d',gold:'e6bd45',goldLight:'fff091',goldDark:'a87828',trunk:'795334',trunkLight:'ba8b51',blue:'397bb6',blueLight:'78b4d7',blueDark:'204a7c',shell:'5b5145',shellLight:'8b7b61',shellDark:'38332f',metal:'a9b4bb',metalLight:'e2e5dc',metalDark:'687581',hole:'202834',orange:'df682b',orangeLight:'ffae5b',orangeDark:'9b3d24',cream:'f3d893',flame:'ff8f29',flameLight:'ffe16b',flameDark:'d95125',charcoal:'36424d',charcoalLight:'64727d',wingBlue:'315d78',cyan:'27b8dc',ice:'a6e6ef'};
function rgb(h){return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}
const CACHE=new Map();function colour(h){if(!CACHE.has(h))CACHE.set(h,rgb(h));return CACHE.get(h)}
function dot(im,x,y,h){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=im.w||y>=im.h)return;im.data.set([...colour(h),255],(y*im.w+x)*4);}
function line(im,a,b,h=K,width=1){let x=Math.round(a[0]),y=Math.round(a[1]),tx=Math.round(b[0]),ty=Math.round(b[1]),dx=Math.abs(tx-x),sx=x<tx?1:-1,dy=-Math.abs(ty-y),sy=y<ty?1:-1,e=dx+dy;for(;;){for(let j=0;j<width;j++)for(let i=0;i<width;i++)dot(im,x+i,y+j,h);if(x===tx&&y===ty)break;const e2=2*e;if(e2>=dy){e+=dy;x+=sx}if(e2<=dx){e+=dx;y+=sy}}}
function poly(im,pts,fill,stroke=K){const p=pts.map(a=>a.map(Math.round));let top=Math.max(0,Math.min(...p.map(q=>q[1]))),bottom=Math.min(im.h-1,Math.max(...p.map(q=>q[1])));for(let y=top;y<=bottom;y++){const intersections=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))intersections.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}intersections.sort((a,b)=>a-b);for(let i=0;i+1<intersections.length;i+=2)for(let x=Math.ceil(intersections[i]);x<=Math.floor(intersections[i+1]);x++)dot(im,x,y,fill);}if(stroke)for(let i=0;i<p.length;i++)line(im,p[i],p[(i+1)%p.length],stroke);}
function ellipse(im,c,rx,ry,fill,stroke=K){poly(im,Array.from({length:20},(_,i)=>[c[0]+Math.cos(i*Math.PI/10)*rx,c[1]+Math.sin(i*Math.PI/10)*ry]),fill,stroke);}
function blit(dst,src){G.blitScaled(dst,src,0,0,src.w,src.h,0,0,1);}
function projector(row,anchor){const t=row*Math.PI/4,c=Math.cos(t),s=Math.sin(t);return q=>({p:[anchor[0]+q[0]*c+q[2]*s,anchor[1]-q[1]+(q[2]*c-q[0]*s)*.43],z:q[2]*c-q[0]*s});}
function model(row,anchor){const pr=projector(row,anchor),commands=[];return {face(points,fill,stroke=K,bias=0){const projected=points.map(pr);commands.push({points:projected.map(p=>p.p),z:projected.reduce((s,p)=>s+p.z,0)/projected.length+bias,fill,stroke});},draw(im){for(const q of commands.sort((a,b)=>a.z-b.z))poly(im,q.points,q.fill,q.stroke);},pr,commands};}
function add(a,b,k=1){return a.map((v,i)=>v+b[i]*k)}
function norm(v){const n=Math.hypot(...v);return v.map(x=>x/n)}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function cannon(m,start,end,r){const axis=norm(end.map((v,i)=>v-start[i])),u=norm(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),v=cross(axis,u);const ring=(c,rad)=>Array.from({length:10},(_,i)=>add(add(c,u,Math.cos(i*Math.PI/5)*rad),v,Math.sin(i*Math.PI/5)*rad));const a=ring(start,r*.9),b=ring(end,r),inside=ring(end,r*.62);for(let i=0;i<10;i++)m.face([a[i],a[(i+1)%10],b[(i+1)%10],b[i]],[C.metalLight,C.metal,C.metal,C.metalDark][Math.floor(i/3)%4]);m.face(b,C.metalLight,K,3);m.face(inside,C.hole,K,4);}
function leaf(m,at,dx,dz,size=1){const p=[[0,0,0],[dx*.2,3,dz*.2],[dx*.6,1,dz*.5],[dx*.52,-2,dz*.72],[dx,-5,dz],[dx*.48,-4,dz*.8],[dx*.25,-1,dz*.5]].map(q=>add(at,q.map(n=>n*size)));m.face(p,C.leafDark);m.face([p[0],p[1],p[2],p[4]],C.leaf);m.face([p[0],p[1],p[4]],C.leafLight,null,.2);}
function crown(im,center,w,h){poly(im,[[center[0]-w/2,center[1]],[center[0]-w*.56,center[1]-h],[center[0]-w*.25,center[1]-h*.48],[center[0],center[1]-h*1.18],[center[0]+w*.25,center[1]-h*.48],[center[0]+w*.56,center[1]-h],[center[0]+w/2,center[1]]],C.gold);line(im,[center[0]-w*.4,center[1]-2],[center[0]+w*.4,center[1]-2],C.goldLight);}
function flower(m,R,H,gmax){const n=gmax?7:6;for(let i=0;i<n;i++){const t=i*Math.PI*2/n,polar=(r,h,a)=>[Math.cos(a)*r,h,Math.sin(a)*r];const p=gmax?[polar(1,H,t),polar(R*.5,H*.92,t-.24),polar(R*.85,H*.62,t-.49),polar(R,H*.07,t-.49),polar(R*.98,-2,t),polar(R,H*.07,t+.49),polar(R*.85,H*.62,t+.49),polar(R*.5,H*.92,t+.24)]:[polar(2,H,t),polar(R*.45,H+4,t-.42),polar(R*.92,H+1,t-.59),polar(R,H-4,t),polar(R*.92,H+1,t+.59),polar(R*.45,H+4,t+.42)];m.face(p,i%3===0?C.pinkDark:C.pink);if(gmax){m.face([p[0],p[1],p[2],polar(R*.72,H*.62,t)],C.pinkLight,null,.2);m.face([p[2],p[3],p[4],polar(R*.85,H*.5,t)],C.pinkDark,null,.3);}else m.face([p[0],p[1],p[2],polar(R*.55,H+2,t)],C.pinkLight,null,.2);}}
function tinyFlower(im,x,y,r){for(let i=0;i<5;i++){const t=i*Math.PI*2/5-Math.PI/2;ellipse(im,[x+Math.cos(t)*r*.6,y+Math.sin(t)*r*.5],r*.48,r*.38,C.pink,C.pinkDark);}ellipse(im,[x,y],r*.28,r*.22,C.gold,C.goldDark);}
function venusaur(im,row,anchors,gmax){const c=[anchors.center[0],anchors.center[1]-(gmax?10:0)],h=anchors.head,pr=projector(row,c),m=model(row,c);for(let i=0;i<10;i++){const a=i*Math.PI/5;leaf(m,[Math.cos(a)*10,2,Math.sin(a)*10],Math.cos(a)*(gmax?28:22),Math.sin(a)*(gmax?28:22),1);if(gmax)leaf(m,[Math.cos(a)*24,-2,Math.sin(a)*24],Math.cos(a)*8,Math.sin(a)*9,1.1);}
if(!gmax){m.face([[-5,0,-5],[5,0,-5],[5,25,-3],[-5,25,-3]],C.trunk);m.face([[5,0,-5],[6,0,4],[4,25,3],[5,25,-3]],C.trunkLight);}
flower(m,gmax?38:29,gmax?30:27,gmax);m.draw(im);if(gmax){const fringe=model(row,c);for(let i=0;i<18;i++){const a=i*Math.PI/9;leaf(fringe,[Math.cos(a)*34,-2,Math.sin(a)*34],Math.cos(a)*6,Math.sin(a)*7,.9);}fringe.draw(im);}const top=pr([0,gmax?31:31,0]).p;crown(im,top,gmax?15:10,gmax?10:5);
// Keep the original face unobstructed; the forehead blossom belongs above its eyes.
if(!gmax&&[0,1,2,6,7].includes(row))tinyFlower(im,h[0],h[1]-12,6);
if(!gmax&&[3,4,5].includes(row)){const q=pr([0,-8,-18]).p;tinyFlower(im,q[0],q[1],6);}
}
function shell(m,gmax){const rx=gmax?29:21,rz=gmax?24:16,H=gmax?33:23;const rings=[0,.35,.65,.85,1];for(let band=0;band<rings.length-1;band++)for(let i=0;i<10;i++){const t=i*Math.PI/5,t2=(i+1)*Math.PI/5,point=(r,a)=>[Math.cos(a)*rx*r,H*Math.sqrt(1-r*r)-3,Math.sin(a)*rz*r];const a=point(rings[band],t),b=point(rings[band+1],t),c=point(rings[band+1],t2),d=point(rings[band],t2);m.face([a,b,c,d],[C.shellLight,C.shell,C.shellDark][band===0?0:band===3?2:1]);}
const rim=Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8)*rx,-3,Math.sin(i*Math.PI/8)*rz]);for(let i=0;i<16;i++)m.face([rim[i],rim[(i+1)%16],add(rim[(i+1)%16],[0,-3,0]),add(rim[i],[0,-3,0])],C.metalLight);
// Hexagonal armour plates, not a rectangular wall.
for(const [x,z,h,r]of [[0,0,H,8],[-rx*.5,0,H*.78,6],[rx*.5,0,H*.78,6],[0,-rz*.55,H*.75,6],[0,rz*.55,H*.75,6]]){const points=Array.from({length:6},(_,i)=>[x+Math.cos(i*Math.PI/3)*r,h,z+Math.sin(i*Math.PI/3)*r]);m.face(points,gmax?C.shellDark:C.shellLight,gmax?C.metal:K,2);}}
function blastoise(im,body,row,anchors,gmax){const c=anchors.center,h=anchors.head,back=[3,4,5].includes(row),m=model(row,[c[0],c[1]+4]);shell(m,gmax);
if(gmax){for(const [x,z,h,r]of [[-18,-12,17,4],[0,-18,20,4.5],[18,-12,17,4],[-25,2,8,3.5],[25,2,8,3.5],[-16,16,11,3.5],[0,20,9,4],[16,16,11,3.5]])cannon(m,[x,h,z],[x*1.3,h+9,z*1.3],r);}else cannon(m,[0,18,-8],[0,28,30],6);
if(!back){m.draw(im);blit(im,body);}else {blit(im,body);m.draw(im);}
// Actual PMD head and forelimbs sit in front of the shell in side/forward views.
for(let y=0;y<body.h;y++)for(let x=0;x<body.w;x++){const idx=(y*body.w+x)*4;if(!body.data[idx+3])continue;const head=((x-h[0])/12)**2+((y-h[1])/12)**2<1,arms=[anchors.handL,anchors.handR].some(q=>((x-q[0])/8)**2+((y-q[1])/9)**2<1);if((head&&row!==4)||arms)im.data.set(body.data.subarray(idx,idx+4),idx);}
if(!gmax){for(const a of [anchors.handL,anchors.handR]){if(row===4)continue;const arm=model(row,a);arm.face([[-6,3,-4],[6,3,-4],[6,-5,4],[-6,-5,4]],C.shell,C.metalLight);cannon(arm,[0,0,0],[0,2,11],3.5);arm.draw(im);}if([0,1,2,6,7].includes(row))poly(im,[[h[0]-5,h[1]+4],[h[0]+4,h[1]+4],[h[0]+3,h[1]+8],[h[0],h[1]+10],[h[0]-3,h[1]+8]],C.metalLight);}
}
function flame(im,at,w,h,phase=0,blue=false){const [x,y]=at;const p=[[x-w*.4,y],[x-w*.58,y-h*.3],[x-w*.25,y-h*.55],[x-w*.28,y-h*.9],[x,y-h*.68],[x+w*.23,y-h*(1+.05*Math.sin(phase))],[x+w*.28,y-h*.55],[x+w*.52,y-h*.4],[x+w*.45,y-h*.1],[x+w*.1,y+2]];poly(im,p,blue?C.cyan:C.flameDark);poly(im,[[x-w*.25,y],[x-w*.3,y-h*.3],[x,y-h*.6],[x+w*.2,y-h*.8],[x+w*.24,y-h*.33],[x+w*.25,y]],blue?C.ice:C.flame);poly(im,[[x-w*.1,y],[x-w*.15,y-h*.2],[x+w*.1,y-h*.45],[x+w*.15,y]],blue?'e6fbfa':C.flameLight,null);}
function charizard(im,body,row,anchors,type,phase){const c=anchors.center,h=anchors.head,m=model(row,c),xForm=type==='x',giant=type==='gmax',sideProfile=[2,6].includes(row);
for(const side of [-1,1]){
 const mul=p=>p.map(q=>[q[0]*side,q[1],q[2]]);
 if(giant){const p=mul([[8,8,-3],[12,27,-8],[19,21,-10],[22,45,-13],[26,26,-16],[35,36,-18],[32,15,-15],[41,22,-20],[32,0,-12],[17,-4,-5]]);m.face(p,C.flameDark);m.face(mul([[10,8,-3],[17,23,-8],[22,35,-12],[24,18,-14],[33,28,-17],[28,6,-12],[34,12,-17],[23,0,-8]]),C.flame);m.face(mul([[11,9,-3],[19,21,-9],[23,28,-12],[22,11,-10],[29,17,-14],[24,3,-9]]),C.flameLight,null);}
 else {const outer=mul(xForm?[[8,7,-5],[17,26,-12],[37,31,-16],[30,18,-14],[43,9,-18],[30,8,-13],[39,-4,-14],[22,0,-8],[13,-9,-5]]:[[8,8,-4],[14,31,-8],[29,40,-13],[36,20,-14],[41,2,-18],[29,10,-13],[26,-6,-9],[18,1,-7],[12,-10,-5]]);m.face(outer,xForm?C.charcoal:C.orangeDark);const inner=mul(xForm?[[10,8,-5],[19,24,-11],[32,26,-14],[26,16,-12],[35,9,-15],[25,7,-10],[31,-1,-10],[19,0,-7]]:[[11,8,-5],[17,28,-8],[27,33,-11],[31,18,-12],[34,5,-14],[26,12,-10],[23,-2,-8],[18,5,-6]]);m.face(inner,C.wingBlue);m.face(mul([[12,9,-5],[xForm?30:26,xForm?25:32,-12],[19,16,-8]]),xForm?C.charcoalLight:C.orangeLight,null);}
}
m.draw(im);blit(im,body);
if(type==='y'){const horn=model(row,h);for(const x of [-4,0,4])horn.face([[x-2,7,-2],[x,19,-7],[x+2,8,0]],C.orangeLight);horn.draw(im);}
if(xForm){const pr=projector(row,h);for(const x of row===0?[-7,7]:row===4?[]:[row<4?7:-7])flame(im,pr([x,-1,3]).p,10,17,phase,true);}
if(giant){const pr=projector(row,c);for(const x of [-11,11]){const q=pr([x,12,-2]).p;flame(im,q,9,17,phase,false);} // continuous shoulders join the flame wings
// Ember pattern only inside existing belly pixels, so face/limb topology is unchanged.
for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const i=(y*im.w+x)*4;if(im.data[i+3]&&im.data[i]>180&&im.data[i+1]>140&&im.data[i+2]>60&&im.data[i+2]<190&&y>c[1]&&Math.abs(x-c[0])<15){if((x-c[0]+y-c[1]*2)%11===0)dot(im,x,y,C.orange);}}
}
}
function clean(raw,body,ctx){const {id,anchors,row}=ctx,ven=id.startsWith('0003'),blast=id.startsWith('0009'),char=id.startsWith('0006'),c=anchors.center,h=anchors.head;
const data=body.data,original=raw.data,bodySet=new Set(ven?['87afcf','67879f','3f576f','ffffff']:blast?['373f8f','4f5f97','6787af','ffe79f','dfaf67']:[]);
const nearBlue=(x,y)=>{for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=raw.w||Y>=raw.h)continue;const i=(Y*raw.w+X)*4;if(original[i+3]&&bodySet.has(Buffer.from(original.subarray(i,i+3)).toString('hex')))return true}return false};
for(let y=0;y<raw.h;y++)for(let x=0;x<raw.w;x++){const i=(y*raw.w+x)*4;if(!original[i+3])continue;const colour=Buffer.from(original.subarray(i,i+3)).toString('hex');let erase=false;
if(ven){erase=!bodySet.has(colour)&&colour!=='000000'&&!(colour==='9f0000'&&((x-h[0])/15)**2+((y-h[1])/9)**2<1);if(colour==='000000'&&!nearBlue(x,y))erase=true;}
if(blast){erase=['773f00','af671f','b7bfc7'].includes(colour);if(colour==='ffffff'&&y<c[1]-4)erase=true;if(colour==='000000'&&!nearBlue(x,y))erase=true;}
if(char&&!id.endsWith('-x')){const torso=((x-c[0])/17)**2+((y-c[1])/24)**2<1,head=((x-h[0])/16)**2+((y-h[1])/17)**2<1,hand=[anchors.handL,anchors.handR].some(q=>Math.abs(x-q[0])<7&&Math.abs(y-q[1])<7);erase=colour==='373f8f'||(!torso&&!head&&!hand&&y<c[1]+3);}
if(char&&id.endsWith('-x')){const torso=((x-c[0])/18)**2+((y-c[1])/25)**2<1,head=((x-h[0])/17)**2+((y-h[1])/17)**2<1,hand=[anchors.handL,anchors.handR].some(q=>Math.abs(x-q[0])<8&&Math.abs(y-q[1])<8);erase=!torso&&!head&&!hand&&y<c[1]+2;}
if(erase)data[i+3]=0;
}return body;}
function compose(raw,body,ctx){clean(raw,body,ctx);const im=G.newImg(body.w,body.h);if(ctx.id.startsWith('0003')){blit(im,body);venusaur(im,ctx.row,ctx.anchors,ctx.id.endsWith('gmax'));}else if(ctx.id.startsWith('0009'))blastoise(im,body,ctx.row,ctx.anchors,ctx.id.endsWith('gmax'));else charizard(im,body,ctx.row,ctx.anchors,ctx.id.endsWith('-x')?'x':ctx.id.endsWith('-y')?'y':'gmax',ctx.frame*.6);return im;}
function palette(id){const base={'000000':K,'ffffff':WHITE};if(id.startsWith('0003'))return {...base,'87afcf':C.bodyLight,'67879f':C.body,'3f576f':C.bodyDark,'9f0000':'a82e49','d73f00':C.pinkDark,'ff875f':C.pinkLight,'278700':C.leafDark,'5fb727':C.leaf,'9fcf6f':C.leafLight,'d7efa7':C.goldLight,'a76f00':C.goldDark,'dfb700':C.gold};
if(id.startsWith('0009'))return {...base,'373f8f':C.blueDark,'4f5f97':C.blue,'6787af':C.blueLight,'773f00':C.shellDark,'af671f':C.shell,'b7bfc7':C.metal,'ffe79f':id.endsWith('gmax')?'dc8059':C.cream,'dfaf67':id.endsWith('gmax')?'a8543b':'c8a66c'};
if(id.endsWith('-x'))return {...base,'282827':'25303b','3f3f3f':C.charcoal,'4f4f4f':'495763','676767':C.charcoalLight,'07274f':'15384d','073777':'24546f','2f577f':C.wingBlue,'275f7f':'37738e','4f6fb7':'508faa','0f87df':C.cyan,'67bfe7':'72d3e6','97e7f7':C.ice,'b70000':'cf3e45'};
return {...base,'d73f00':C.orange,'9f0000':C.orangeDark,'ff875f':C.orangeLight,'373f8f':C.wingBlue,'fff700':C.cream,'dfb700':'d5b36b','a76f00':'9d7b42','bfcff7':C.metalLight};}
module.exports={compose,palette,poly,line,ellipse,C};
