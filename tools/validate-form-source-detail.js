'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const G=require('./build-gif-anim');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review'),BACKUP=path.join(OUT,'form-pmd-v1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const catalog=JSON.parse(fs.readFileSync(path.join(OUT,'catalog.json'))),forms=catalog.records.filter(r=>r.category!=='normal');assert.equal(forms.length,7);
const comparison=G.newImg(960,7*412);G.fill(comparison,0,0,comparison.w,comparison.h,[229,236,242]);const P=require('./pixelize'),records=[];
for(const [index,r]of forms.entries()){
 assert.equal(r.sourceMode,'source-detail');assert.equal(r.fw,320);assert(r.pmdVariant);const colours=new Set();
 for(const s of r.sources){const file=path.resolve(ROOT,s.file);assert.equal(hash(fs.readFileSync(file)),s.sha256);const g=G.decodeGif(file);for(const f of g.frames)for(let i=0;i<f.data.length;i+=4)if(f.data[i+3])colours.add(Buffer.from(f.data.subarray(i,i+3)).toString('hex'));}
 for(const a of Object.values(r.anims)){
  const b=fs.readFileSync(path.join(OUT,r.id,a.file));assert.equal(b.readUInt32BE(16),a.frames*320);assert.equal(b.readUInt32BE(20),8*320);assert.equal(b[25],3,'Expected indexed lossless output for palette audit');let pos=8,plte,alpha;
  while(pos<b.length){const n=b.readUInt32BE(pos),type=b.toString('ascii',pos+4,pos+8),d=b.subarray(pos+8,pos+8+n);if(type==='PLTE')plte=d;if(type==='tRNS')alpha=d;pos+=n+12;}
  assert(plte);for(let i=0;i<plte.length/3;i++){if(alpha&&i<alpha.length&&alpha[i]===0)continue;assert(colours.has(plte.subarray(i*3,i*3+3).toString('hex')),r.id+' non-source colour');}
 }
 const cmp=P.decodePng(path.join(OUT,r.id,'quality-comparison.png'));G.bigText(comparison,10,index*412+8,r.id.toUpperCase(),[25,42,59]);G.blitScaled(comparison,cmp,0,0,cmp.w,cmp.h,0,index*412+32,1);
 records.push({id:r.id,sourceColoursOnly:true,sourceColourCount:colours.size,sourceFilesUnchanged:true,projectedDirections:r.directionSources});
}
const normals=JSON.parse(fs.readFileSync(path.join(BACKUP,'normal-sheets-before.json')));for(const f of normals)assert.equal(hash(fs.readFileSync(path.join(OUT,f.file))),f.sha256,'Normal sprite changed '+f.file);
fs.writeFileSync(path.join(OUT,'form-quality-comparison.png'),G.encodePng(comparison));
const result={passed:true,forms:7,sheets:35,normalSheetsUnchanged:normals.length,method:'source pixels + explicitly approximate projection',records};fs.writeFileSync(path.join(OUT,'form-detail-validation.json'),JSON.stringify(result,null,2)+'\n');console.log({passed:true,forms:7,sheets:35,sourceColoursOnly:true,normalSheetsUnchanged:normals.length});
