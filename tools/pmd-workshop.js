#!/usr/bin/env node
// Eight-direction, per-action pixel authoring. Never writes pokeAnim or its manifests.
'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const P=require('./pixelize'), G=require('./build-gif-anim'), SC=require('./build-mega-parts');
const ROOT=path.resolve(__dirname,'..'), DIRS=['S','SE','E','NE','N','NW','W','SW'];
const CHARS='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@$%&*+=?:;,';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,o)=>fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n');
function safeName(s){if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error('Invalid name: '+s);return s;}
function init(folder,sc,id,review){
  safeName(id);
  if(!/^\d{4}(\/\d{4})*$/.test(sc))throw Error('Invalid SpriteCollab path');
  if(fs.existsSync(folder))throw Error('Project already exists; choose a new directory');
  const src=path.join(ROOT,'.cache/SpriteCollab/sprite',sc), data=SC.readAnimData(src);
  const project={version:1,id,scale:2,shadowSize:data.shadowSize,dirs:DIRS,source:json(path.join(src,'provenance.json')),palette:{},anims:{}};
  const palette=new Map(), images={};
  for(const name of ['Idle','Walk','Attack','Shoot','SpAttack','Charge','Strike','Hurt','Faint']){
    const a=SC.resolveAnim(src,data,name);if(!a)continue;
    let im=P.decodePng(a.file);
    if(review){
      const rec=json(path.join(review,'manifest-fragment.json')),ra=rec.anims[name];
      if(!ra)continue;
      const big=P.decodePng(path.join(review,name+'.png')),s=rec.scale;
      if(!Number.isInteger(s)||s<1||s>4||ra.fw%s||ra.fh%s||big.w%s||big.h%s)throw Error('Review must have an integer native scale');
      im=G.newImg(big.w/s,big.h/s);
      for(let y=0;y<big.h;y++)for(let x=0;x<big.w;x++){
        const i=(y*big.w+x)*4,j=((y-y%s)*big.w+x-x%s)*4;
        if([0,1,2,3].some(k=>big.data[i+k]!==big.data[j+k]))throw Error(name+': review is not an exact integer enlargement');
        im.data.set(big.data.subarray(i,i+4),(Math.floor(y/s)*im.w+Math.floor(x/s))*4);
      }
      Object.assign(a,{fw:ra.fw/s,fh:ra.fh/s,durations:ra.durations,hit:ra.hit,rush:ra.rush,ret:ra.ret});
      project.derivation={review:path.resolve(review),record:rec};
    }
    const rows=im.h/a.fh,frames=im.w/a.fw;
    if(![1,8].includes(rows)||!Number.isInteger(frames)||frames!==a.durations.length)throw Error('Invalid source layout '+name);
    for(let i=0;i<im.data.length;i+=4){
      if(!im.data[i+3])continue;
      if(im.data[i+3]!==255)throw Error('Partial alpha in source');
      const hex=Buffer.from(im.data.subarray(i,i+3)).toString('hex');
      if(!palette.has(hex)){if(palette.size>=CHARS.length)throw Error('Too many colours');palette.set(hex,CHARS[palette.size]);}
    }
    project.anims[name]={fw:a.fw,fh:a.fh,rows,frames,durations:a.durations,hit:a.hit,rush:a.rush,ret:a.ret,sourceAnimation:a.name,sourceSha256:hash(fs.readFileSync(a.file))};
    images[name]=im;
  }
  if(!project.anims.Idle)throw Error('No Idle');
  project.palette=Object.fromEntries([...palette].map(([hex,ch])=>[ch,hex]));
  fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(folder,'reference'));
  fs.copyFileSync(path.join(src,'credits.txt'),path.join(folder,'credits.txt'));
  const license=path.join(ROOT,'.cache/SpriteCollab/reference-metadata',project.source.revision,'LICENSE.md');
  if(fs.existsSync(license))fs.copyFileSync(license,path.join(folder,'LICENSE.md'));
  for(const [name,a]of Object.entries(project.anims)){
    const im=images[name];fs.writeFileSync(path.join(folder,'reference',name+'.png'),G.encodePng(im));
    const dest=path.join(folder,'pixels',name);fs.mkdirSync(dest,{recursive:true});
    for(let r=0;r<a.rows;r++)for(let f=0;f<a.frames;f++){
      const lines=[];
      for(let y=0;y<a.fh;y++){let line='';for(let x=0;x<a.fw;x++){
        const i=((r*a.fh+y)*im.w+f*a.fw+x)*4;
        line+=im.data[i+3]?palette.get(Buffer.from(im.data.subarray(i,i+3)).toString('hex')):'.';
      }lines.push(line);}
      fs.writeFileSync(path.join(dest,`${DIRS[r]}-${String(f).padStart(3,'0')}.txt`),lines.join('\n')+'\n');
    }
  }
  // Source front/back are visual design references, independent of animation direction grids.
  const roster=json(path.join(ROOT,'pokeData/index.json')).pokemon.find(p=>p.id===id);
  if(roster){const sourceDir=path.dirname(path.resolve(ROOT,'game',roster.sprite));
    for(const side of ['front','back']){const file=path.join(sourceDir,side+'.png');if(fs.existsSync(file))fs.copyFileSync(file,path.join(folder,'reference','pokeSprite-'+side+'.png'));}}
  write(path.join(folder,'project.json'),project);
  return project;
}
function build(folder){
  const p=json(path.join(folder,'project.json')), sheets={}, warnings=[], metrics={};
  if(!Number.isInteger(p.scale)||p.scale<1||p.scale>4)throw Error('scale must be 1..4');
  const pal={};for(const[c,h]of Object.entries(p.palette)){
    if(c.length!==1||c==='.'||/\s/.test(c)||!/^[0-9a-f]{6}$/i.test(h))throw Error('Invalid palette entry');
    pal[c]=[...Buffer.from(h,'hex'),255];
  }
  const rec={src:p.id,exact:true,source:'workshop',shadowSize:p.shadowSize??2,anims:{}};
  for(const[name,a]of Object.entries(p.anims)){
    safeName(name);
    if(![a.fw,a.fh,a.frames,a.rows].every(n=>Number.isInteger(n)&&n>0)||a.fw>512||a.fh>512||a.frames>200||![1,8].includes(a.rows))throw Error(name+': invalid dimensions');
    if(a.durations.length!==a.frames||!a.durations.every(t=>Number.isInteger(t)&&t>0))throw Error(name+': invalid durations');
    for(const key of ['hit','rush','ret'])if(a[key]!=null&&(!Number.isInteger(a[key])||a[key]<0||a[key]>=a.frames))throw Error(name+': invalid '+key);
    const im=G.newImg(a.fw*a.frames,a.fh*a.rows),colors=new Set();let touched=0;
    for(let r=0;r<a.rows;r++)for(let f=0;f<a.frames;f++){
      const namef=`${DIRS[r]}-${String(f).padStart(3,'0')}.txt`;
      const lines=fs.readFileSync(path.join(folder,'pixels',name,namef),'utf8').replace(/\r/g,'').replace(/\n$/,'').split('\n');
      if(lines.length!==a.fh||lines.some(l=>l.length!==a.fw))throw Error(name+'/'+namef+': grid size mismatch');
      let opaque=0;
      lines.forEach((l,y)=>[...l].forEach((c,x)=>{if(c==='.')return;if(!pal[c])throw Error(name+'/'+namef+': unknown colour '+c);
        im.data.set(pal[c],((r*a.fh+y)*im.w+f*a.fw+x)*4);colors.add(p.palette[c]);opaque++;
        if(x===0||y===0||x===a.fw-1||y===a.fh-1)touched++;
      }));if(!opaque)throw Error(name+'/'+namef+': empty cell');
    }
    if(colors.size>15)warnings.push(`${name}: ${colors.size} colours (target <=15)`);
    if(touched)warnings.push(`${name}: ${touched} opaque pixels touch cell edges; review clipping`);
    const big=G.newImg(im.w*p.scale,im.h*p.scale);
    G.blitScaled(big,im,0,0,im.w,im.h,0,0,p.scale);
    sheets[name]={native:im,output:big};
    rec.anims[name]={...a,fw:a.fw*p.scale,fh:a.fh*p.scale,file:name+'.png'};
    const original=P.decodePng(path.join(folder,'reference',name+'.png'));
    let changed=0;
    if(original.w===im.w&&original.h===im.h){for(let i=0;i<im.data.length;i+=4)if([0,1,2,3].some(k=>im.data[i+k]!==original.data[i+k]))changed++;}else changed=null;
    metrics[name]={colors:colors.size,cells:a.rows*a.frames,changedPixels:changed,edgePixels:touched};
  }
  const a=rec.anims.Idle,im=sheets.Idle.output;
  let x0=a.fw,y0=a.fh,x1=-1,y1=-1;
  for(let f=0;f<a.frames;f++)for(let y=0;y<a.fh;y++)for(let x=0;x<a.fw;x++)if(im.data[(y*im.w+f*a.fw+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  rec.bodyH=y1-y0+1;rec.bodyW=x1-x0+1;
  const foot=y1+1-a.fh/2;for(const a of Object.values(rec.anims))a.anchorY=a.fh/2+foot;
  const out=path.join(folder,'build');fs.mkdirSync(out,{recursive:true});
  for(const[n,s]of Object.entries(sheets))fs.writeFileSync(path.join(out,n+'.png'),G.encodePng(s.output));
  write(path.join(out,'manifest-fragment.json'),rec);write(path.join(out,'validation.json'),{structuralPass:true,visualApproval:false,warnings,metrics});
  const payload={project:p,record:rec,metrics,warnings,images:{},reference:{},design:{}};
  for(const[n,s]of Object.entries(sheets)){payload.images[n]='data:image/png;base64,'+G.encodePng(s.output).toString('base64');payload.reference[n]='data:image/png;base64,'+fs.readFileSync(path.join(folder,'reference',n+'.png')).toString('base64');}
  for(const side of ['front','back']){const f=path.join(folder,'reference','pokeSprite-'+side+'.png');if(fs.existsSync(f))payload.design[side]='data:image/png;base64,'+fs.readFileSync(f).toString('base64');}
  const template=fs.readFileSync(path.join(__dirname,'pmd-workshop-view.html'),'utf8');
  fs.writeFileSync(path.join(out,'preview.html'),template.replace('/*WORKSHOP_DATA*/',JSON.stringify(payload).replace(/</g,'\\u003c')));
  return {out,warnings,metrics};
}
if(require.main===module){
  const[cmd,folder,sc,id,review]=process.argv.slice(2);
  if(!folder||!['init','build'].includes(cmd))throw Error('Usage: pmd-workshop.js init PROJECT SC_PATH ROSTER_ID [REVIEW_DIR] | build PROJECT');
  const dest=path.resolve(folder);
  if(dest===path.join(ROOT,'pokeAnim')||dest.startsWith(path.join(ROOT,'pokeAnim')+path.sep))throw Error('Use a separate workshop folder');
  if(cmd==='init')init(dest,sc,id,review);
  console.log(JSON.stringify(build(dest),null,2));
}
module.exports={init,build};
