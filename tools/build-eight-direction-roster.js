#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const G=require('./build-gif-anim'),P=require('./pixelize'),{createEngine,ACTIONS}=require('./eight-direction-engine');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review');
const DIRS=['S','SE','E','NE','N','NW','W','SW'],VERSION='eight-direction-roster-v1';
const ROSTER=JSON.parse(fs.readFileSync(path.join(ROOT,'pokeData/index.json'))).pokemon.filter(p=>p.dex>=1&&p.dex<=9);
const JP=['','フシギダネ','フシギソウ','フシギバナ','ヒトカゲ','リザード','リザードン','ゼニガメ','カメール','カメックス'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),hex=a=>Buffer.from(a).toString('hex');
const rgb=h=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
const json=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');
const png=(f,v)=>fs.writeFileSync(f,G.encodePng(v));
function label(p){return p.category==='mega'?'メガ'+JP[p.dex]+(p.id.endsWith('-x')?'X':p.id.endsWith('-y')?'Y':''):JP[p.dex]+(p.category==='gigantamax'?'（キョダイマックス）':'');}
function colours(images){const out=new Map();for(const im of images)for(let i=0;i<im.data.length;i+=4)if(im.data[i+3]){const h=hex(im.data.subarray(i,i+3));out.set(h,(out.get(h)||0)+1)}return out;}
function palette(source,reference){const targets=[...colours(reference)].map(([h,n])=>({h,n,c:rgb(h),lab:P.rgbToOklab(...rgb(h))}));const map={};
for(const h of colours(source).keys()){
 const c=rgb(h),lab=P.rgbToOklab(...c),sat=Math.max(...c)-Math.min(...c);
 if(Math.max(...c)<32){map[h]='101010';continue}if(Math.min(...c)>245){map[h]='ffffff';continue}
 let best=Infinity,winner=h;
 for(const t of targets){if(Math.max(...t.c)<32)continue;const ts=Math.max(...t.c)-Math.min(...t.c);const ca=Math.hypot(lab[1],lab[2]),cb=Math.hypot(t.lab[1],t.lab[2]);let angle=Math.abs(Math.atan2(lab[2],lab[1])-Math.atan2(t.lab[2],t.lab[1]));angle=Math.min(angle,Math.PI*2-angle);
 const cost=lab.reduce((s,v,i)=>s+(v-t.lab[i])**2*(i===0?1:1.7),0)+(ca>.04&&cb>.04?.025*angle*angle:0)+(sat<25&&ts>55?.12:0)+(sat>60&&ts<18?.12:0);
 if(cost<best){best=cost;winner=t.h}
 }map[h]=winner;
}return map;}
function srcFiles(p){const src=path.dirname(p.sprite.replace('../pokeSprite/',''));return {src,pmd:path.resolve(ROOT,'../確認用画像/reference-study',src),poke:path.join(ROOT,'pokeSprite',src)};}
function sourceMeasure(images,anims){let left=0,right=0,top=0,bottom=0,idleExtent=0;
for(const [name,im] of Object.entries(images)){const a=anims[name];for(let row=0;row<a.rows;row++)for(let k=0;k<a.frames;k++){let x0=a.fw,y0=a.fh,x1=-1,y1=-1;for(let y=0;y<a.fh;y+=2)for(let x=0;x<a.fw;x+=2)if(im.data[((row*a.fh+y)*im.w+k*a.fw+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}if(x1<0)throw Error('Empty input '+name);left=Math.min(left,(x0-a.fw/2)/2);right=Math.max(right,(x1-a.fw/2)/2);top=Math.min(top,(y0-a.anchorY)/2);bottom=Math.max(bottom,(y1-a.anchorY)/2);if(name==='Idle')idleExtent=Math.max(idleExtent,(x1-x0+2)/2,(y1-y0+2)/2);}}
return {left,right,top,bottom,idleExtent};}
function build(p){const paths=srcFiles(p),dest=path.join(OUT,p.id);fs.mkdirSync(dest,{recursive:true});const sourceMeta=JSON.parse(fs.readFileSync(path.join(paths.pmd,'manifest.json'))),anims=sourceMeta.variants.normal.anims;
const sourceImages=Object.fromEntries(Object.keys(ACTIONS).map(n=>[n,P.decodePng(path.join(paths.pmd,n+'.png'))]));
const refs=['front.png','back.png'].map(f=>P.decodePng(path.join(paths.poke,f))),map=palette(Object.values(sourceImages),refs);
const files=[...Object.keys(ACTIONS).map(n=>path.join(paths.pmd,n+'.png')),path.join(paths.pmd,'manifest.json'),...['front.png','back.png','front.gif','back.gif'].map(f=>path.join(paths.poke,f))];
if(sourceMeta.method!=='PMD元素材')files.push(path.join(__dirname,'recolor-parts',p.id+'.json'));
const sources=files.map(f=>({file:path.relative(ROOT,f),sha256:hash(fs.readFileSync(f))}));
const cell=288,foot=180,target=p.category==='gigantamax'?128:p.category==='mega'?112:100,m=sourceMeasure(sourceImages,anims);
const scale=Math.min(target/m.idleExtent,(cell/2-22)/Math.max(-m.left,m.right,1),(foot-22)/Math.max(-m.top,1),(cell-foot-22)/Math.max(m.bottom,1));
const category=p.category==='mega'?'mega':p.category==='gigantamax'?'gigantamax':'normal';
const meta={buildVersion:VERSION,id:p.id,dex:p.dex,name:label(p),englishName:p.name,category,src:paths.src,dirs:DIRS,fw:cell,fh:cell,anchorY:foot,scaleFromNative:scale,sourceMethod:sourceMeta.method,sourceFolder:sourceMeta.sourceFolder,paletteMap:map,sources,anims:{},limitations:['隣接ポーズ間を局所変形で補間。大きな遮蔽・形状変化では切り替わりが残ります。','顔の細部はPMD下地の画素数が上限。拡大で新しく描き足す方式ではありません。']};
if(category!=='normal')meta.limitations.push(sourceMeta.method==='PMD元素材'?'この形態の専用8方向素材を使用。':'基本種の8方向＋既存の形態パーツを使用。形態の全身を専用に描き起こしたものではありません。');
if(anims.Faint.rows<8)meta.limitations.push(`倒れる元絵は${anims.Faint.rows}方向。開始姿勢は8方向ですが、最後の姿勢は共通です。`);else meta.limitations.push('倒れる専用8方向列を使用。ただし元素材の最終姿勢には共通のものがあります。');
const validation={passed:true,id:p.id,sourceHashesUnchanged:false,rows:[],idleDirectionHashes:[]};
if(p.id==='0001_bulbasaur'){
 // Preserve the exact approved prototype pixels, not a regenerated approximation.
 const approved=path.join(OUT,'bulbasaur-eight-directions'),a=JSON.parse(fs.readFileSync(path.join(approved,'manifest.json')));meta.scaleFromNative=a.scaleFromNative;meta.paletteMap=a.paletteMap;meta.approvedPrototype=true;
 for(const n of Object.keys(ACTIONS)){fs.copyFileSync(path.join(approved,n+'.png'),path.join(dest,n+'.png'));meta.anims[n]={...a.anims[n],sourceRows:anims[n].rows,sourceAnimation:anims[n].sourceAnimation};}
 const v=JSON.parse(fs.readFileSync(path.join(approved,'validation.json')));validation.rows=v.rows;validation.idleDirectionHashes=v.sourceDirectionHashes;
}else{
 const E=createEngine({cell,foot,native:192,scale,palette:map});const idle=DIRS.map((_,r)=>E.extract(sourceImages.Idle,anims.Idle,r,0));idle.forEach(i=>i.big=E.scale2x(i));validation.idleDirectionHashes=idle.map(i=>hash(i.data));
 if(new Set(validation.idleDirectionHashes).size!==8)throw Error('Idle directions not distinct '+p.id);
 for(const [name,spec]of Object.entries(ACTIONS)){
  const a=anims[name],sheet=G.newImg(cell*spec.frames,cell*8),tl=E.timeline(a,name),rows=[];
  for(let row=0;row<8;row++){
   const sourceRow=Math.min(row,a.rows-1),poses=Array.from({length:a.frames},(_,k)=>E.extract(sourceImages[name],a,sourceRow,k));poses.forEach(i=>i.big=E.scale2x(i));const get=k=>k<0?idle[row]:poses[k],flows=new Map(),unique=new Set(),bounds=[];
   for(let k=0;k<spec.frames;k++){
    const pos=E.position(tl,k/(spec.loop?spec.frames:spec.frames-1),spec.loop),forward=pos.t<=.5,from=forward?pos.from:pos.to,to=forward?pos.to:pos.from,t=forward?pos.t:1-pos.t,key=from+':'+to;
    if(!flows.has(key))flows.set(key,E.flow(get(from),get(to)));
    const im=E.render(get(from),get(to),flows.get(key),t),b=E.bbox(im);if(b.x0<2||b.y0<2||b.x1>=cell-2||b.y1>=cell-2)throw Error(`Clipped ${p.id}/${name}/${row}/${k}: ${JSON.stringify(b)}`);
    bounds.push(b);unique.add(hash(im.data));G.blitScaled(sheet,im,0,0,cell,cell,k*cell,row*cell,1);
   }rows.push({direction:DIRS[row],sourceRow,uniqueFrames:unique.size,bounds});
  }
  png(path.join(dest,name+'.png'),sheet);meta.anims[name]={...spec,file:name+'.png',fw:cell,fh:cell,rows:8,anchorY:foot,durations:Array(spec.frames).fill(spec.ticks),originalFrames:a.frames,sourceRows:a.rows,sourceAnimation:a.sourceAnimation,hit:name==='Attack'&&a.hit!=null?Math.round(a.durations.slice(0,a.hit).reduce((s,n)=>s+n,0)/tl.total*(spec.frames-1)):null};validation.rows.push({action:name,rows});
  console.log(p.id+' '+name+' '+spec.frames+'x8 / unique '+rows.map(r=>r.uniqueFrames).join(','));
 }
}
// Keep exact reference GIFs visible in the review, including every Mega/Gmax form.
for(const f of ['front.gif','back.gif','front.png','back.png'])fs.copyFileSync(path.join(paths.poke,f),path.join(dest,f));
fs.copyFileSync(path.join(paths.poke,'front.gif'),path.join(dest,'source.gif'));
for(const f of ['credits.txt','provenance.json'])if(fs.existsSync(path.join(paths.pmd,f)))fs.copyFileSync(path.join(paths.pmd,f),path.join(dest,f));
const contact=G.newImg(cell*8,32+5*(cell+24)),directions=G.newImg(cell*8,cell+24);for(const im of [contact,directions])G.fill(im,0,0,im.w,im.h,[229,236,242]);G.bigText(contact,12,8,p.id.toUpperCase(),[25,42,59]);
let ai=0;for(const [name,a]of Object.entries(meta.anims)){const im=P.decodePng(path.join(dest,name+'.png')),k=name==='Walk'?12:name==='Attack'?16:name==='Hurt'?6:name==='Faint'?a.frames-1:0;for(let row=0;row<8;row++){const y=32+ai*(cell+24);G.bigText(contact,row*cell+10,y+5,name.toUpperCase()+' '+DIRS[row],[25,42,59]);G.blitScaled(contact,im,k*cell,row*cell,cell,cell,row*cell,y+24,1);if(name==='Idle'){G.bigText(directions,row*cell+10,5,DIRS[row],[25,42,59]);G.blitScaled(directions,im,0,row*cell,cell,cell,row*cell,24,1)}}ai++;}
png(path.join(dest,'contact.png'),contact);png(path.join(dest,'directions.png'),directions);
const idle=P.decodePng(path.join(dest,'Idle.png')),thumb=G.newImg(cell,cell);G.blitScaled(thumb,idle,0,cell,cell,cell,0,0,1);png(path.join(dest,'thumbnail.png'),thumb);
for(const [i,f]of files.entries())if(sources[i].sha256!==hash(fs.readFileSync(f)))throw Error('Source modified '+f);validation.sourceHashesUnchanged=true;
fs.writeFileSync(path.join(dest,'index.html'),'<!doctype html><meta charset="utf-8"><title>'+meta.name+'</title><a href="../index.html?pokemon='+p.id+'">8方向プレビュー</a><script>location.replace("../index.html?pokemon='+p.id+'")</script>');json(path.join(dest,'manifest.json'),meta);json(path.join(dest,'validation.json'),validation);console.log('DONE '+p.id+' / native scale '+meta.scaleFromNative.toFixed(2));return meta;
}
function publish(){const records=ROSTER.map(p=>{const f=path.join(OUT,p.id,'manifest.json');if(!fs.existsSync(f))throw Error('Missing '+p.id);const r=JSON.parse(fs.readFileSync(f));if(![VERSION,'form-reference-v2','pmd-form-detail-v3','pmd-form-reference-v4'].includes(r.buildVersion))throw Error('Not rebuilt '+p.id);return r});
 const catalog={version:VERSION,dirs:DIRS,actions:ACTIONS,records};json(path.join(OUT,'catalog.json'),catalog);fs.writeFileSync(path.join(OUT,'catalog.js'),'window.ROSTER_EIGHT='+JSON.stringify(catalog)+';\n');fs.copyFileSync(path.join(__dirname,'eight-direction-roster.html'),path.join(OUT,'index.html'));
 for(const r of records)fs.writeFileSync(path.join(OUT,r.id,'index.html'),'<!doctype html><meta charset="utf-8"><title>'+r.name+'</title><a href="../index.html?pokemon='+r.id+'">8方向プレビュー</a><script>location.replace("../index.html?pokemon='+r.id+'")</script>');
 const overview=G.newImg(4*288,4*332);G.fill(overview,0,0,overview.w,overview.h,[229,236,242]);for(const[i,r]of records.entries()){const x=i%4*288,y=Math.floor(i/4)*332;G.bigText(overview,x+9,y+8,r.id.replace(/^000/,'').toUpperCase(),[25,42,59]);const im=P.decodePng(path.join(OUT,r.id,'thumbnail.png'));G.blitScaled(overview,im,0,0,im.w,im.h,x,y+30,288/im.w)}png(path.join(OUT,'overview.png'),overview);
 json(path.join(OUT,'validation.json'),{passed:true,records:records.map(r=>({id:r.id,sourceMethod:r.sourceMethod,sourceFaintRows:r.anims.Faint.sourceRows,report:r.id+'/validation.json'})),sheets:records.length*5,cells:records.length*8*Object.values(ACTIONS).reduce((s,a)=>s+a.frames,0)});console.log('PUBLISHED '+records.length+' entries');
}
if(require.main===module){const idIdx=process.argv.indexOf('--id'),only=idIdx<0?null:process.argv[idIdx+1];if(!process.argv.includes('--publish-only')){const selected=only?ROSTER.filter(p=>p.id===only):ROSTER;if(!selected.length)throw Error('Unknown id '+only);for(const p of selected){const saved=path.join(OUT,p.id,'manifest.json');if(process.argv.includes('--resume')&&fs.existsSync(saved)&&JSON.parse(fs.readFileSync(saved)).buildVersion===VERSION){console.log('SKIP completed '+p.id);continue;}build(p);}}if(!only||process.argv.includes('--publish'))publish();}
module.exports={build,publish,ROSTER};
