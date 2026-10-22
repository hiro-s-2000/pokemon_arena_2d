#!/usr/bin/env node
// Read-only inspection of installed sheets; writes only to the chosen review directory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {decodePng} = require('./pixelize');
const {newImg, fill, text, encodePng} = require('./build-gif-anim');
const root = path.resolve(__dirname, '..');
const id = process.argv[2] || '0006_charizard-mega-x';
const out = path.resolve(process.argv[3] || path.join(root, '../確認用画像/reference-study', id));
const rec = JSON.parse(fs.readFileSync(path.join(root, 'pokeAnim/manifest.json'))).pokemon[id];
if (!rec) throw Error('Unknown roster id');
fs.mkdirSync(out, {recursive:true});
const dirs = ['S','SE','E','NE','N','NW','W','SW'];
const report = {id, src:rec.src, animations:{}};
for (const [name,a] of Object.entries(rec.anims)) {
  const file = path.join(root,'pokeAnim',rec.src,name+'.png');
  const im = decodePng(file);
  if(im.w!==a.fw*a.frames || im.h!==a.fh*a.rows) throw Error(name+' dimensions mismatch');
  const palette = new Map(), boxes=[], hashes=[];
  let minX=a.fw,minY=a.fh,maxX=0,maxY=0, partial=0;
  for(let r=0;r<a.rows;r++) for(let f=0;f<a.frames;f++) {
    let x0=a.fw,y0=a.fh,x1=-1,y1=-1;
    const bytes=[];
    for(let y=0;y<a.fh;y++) for(let x=0;x<a.fw;x++) {
      const i=((r*a.fh+y)*im.w+f*a.fw+x)*4;
      bytes.push(...im.data.subarray(i,i+4));
      if(!im.data[i+3])continue;
      if(im.data[i+3]!==255)partial++;
      const c=Buffer.from(im.data.subarray(i,i+3)).toString('hex');
      palette.set(c,(palette.get(c)||0)+1);
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
    }
    if(x1<0) throw Error(name+' empty cell');
    boxes.push({direction:dirs[r],frame:f,x0,y0,x1,y1,width:x1-x0+1,height:y1-y0+1});
    minX=Math.min(minX,x0);minY=Math.min(minY,y0);maxX=Math.max(maxX,x1);maxY=Math.max(maxY,y1);
    hashes.push(crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
  }
  const cw=maxX-minX+9,ch=maxY-minY+19;
  const contact=newImg(32+cw*a.frames,22+ch*a.rows);
  fill(contact,0,0,contact.w,contact.h,[215,219,225,255]);
  text(contact,3,4,name,[25,25,30,255]);
  for(let r=0;r<a.rows;r++) {
    text(contact,2,22+r*ch+8,dirs[r],[25,25,30,255]);
    for(let f=0;f<a.frames;f++) {
      text(contact,34+f*cw,23+r*ch,`${f}:${a.durations[f]}`,[25,25,30,255]);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
        const s=((r*a.fh+y)*im.w+f*a.fw+x)*4;
        if(!im.data[s+3])continue;
        const t=((22+r*ch+14+y-minY)*contact.w+34+f*cw+x-minX)*4;
        contact.data.set(im.data.subarray(s,s+4),t);
      }
    }
  }
  fs.writeFileSync(path.join(out,name+'-all.png'),encodePng(contact));
  // Test all possible alignments of a nearest-neighbour 2x lattice.
  const lattice=[];
  for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++) {
    let bad=0,total=0;
    for(let y=oy;y+1<im.h;y+=2)for(let x=ox;x+1<im.w;x+=2) {
      const p=(y*im.w+x)*4;
      const ids=[p,p+4,p+im.w*4,p+im.w*4+4];
      if(!ids.some(i=>im.data[i+3]))continue;
      total++;
      if(ids.some(i=>[0,1,2,3].some(k=>im.data[i+k]!==im.data[p+k])))bad++;
    }
    lattice.push({ox,oy,bad,total});
  }
  report.animations[name]={...a,width:im.w,height:im.h,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),colors:palette.size,partialAlphaPixels:partial,uniqueCells:new Set(hashes).size,lattice,palette:[...palette].sort((a,b)=>b[1]-a[1]),boxes};
}
fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.animations).map(([n,a])=>[n,{size:[a.width,a.height],colors:a.colors,unique:a.uniqueCells,lattice:a.lattice,bodyRange:[Math.min(...a.boxes.map(b=>b.height)),Math.max(...a.boxes.map(b=>b.height))]}])),null,2));
