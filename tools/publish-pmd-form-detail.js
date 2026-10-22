'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const G=require('./build-gif-anim'),P=require('./pixelize');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const ids=JSON.parse(fs.readFileSync(path.join(OUT,'catalog.json'))).records.filter(r=>r.category!=='normal').map(r=>r.id);
// Validate the whole staging set before replacing any active review asset.
for(const id of ids){const dir=path.join(OUT,'form-pmd-v3',id),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),v=JSON.parse(fs.readFileSync(path.join(dir,'validation.json')));assert.equal(m.buildVersion,'pmd-form-detail-v3');assert(v.passed);assert.equal(new Set(v.idleDirectionHashes).size,8);for(const a of Object.values(m.anims)){const b=fs.readFileSync(path.join(dir,a.file));assert.equal(b.readUInt32BE(16),a.fw*a.frames);assert.equal(b.readUInt32BE(20),a.fh*8);}for(const s of m.sources)assert.equal(hash(fs.readFileSync(path.resolve(ROOT,s.file))),s.sha256);}
const normals=JSON.parse(fs.readFileSync(path.join(OUT,'form-pmd-v1/normal-sheets-before.json')));for(const f of normals)assert.equal(hash(fs.readFileSync(path.join(OUT,f.file))),f.sha256);
const comparison=G.newImg(1536,ids.length*430);G.fill(comparison,0,0,comparison.w,comparison.h,[229,236,242]);
for(const [i,id]of ids.entries()){
 const dir=path.join(OUT,'form-pmd-v3',id),active=path.join(OUT,id),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),old=JSON.parse(fs.readFileSync(path.join(OUT,'form-source-v2',id,'manifest.json')));
 for(const file of fs.readdirSync(dir))fs.copyFileSync(path.join(dir,file),path.join(active,file));
 m.pmdVariant=old.pmdVariant;fs.writeFileSync(path.join(active,'manifest.json'),JSON.stringify(m,null,2)+'\n');
 const y=i*430;G.bigText(comparison,10,y+6,id.toUpperCase(),[25,42,59]);
 const source=G.decodeGif(path.join(active,'front.gif')),ref={w:source.W,h:source.H,data:source.frames[0].data};
 const images=[ref,P.decodePng(path.join(OUT,'form-pmd-v1',id,'thumbnail.png')),P.decodePng(path.join(active,'thumbnail.png')),P.decodePng(path.join(active,'directions.png'))];
 for(let j=0;j<3;j++){const im=images[j];G.bigText(comparison,j*384+10,y+30,['POKESPRITE','INITIAL PMD','REVISED PMD'][j],[25,42,59]);const scale=j===0?Math.min(2,340/im.w,340/im.h):384/im.w;G.blitScaled(comparison,im,0,0,im.w,im.h,Math.round(j*384+(384-im.w*scale)/2),Math.round(y+58+(340-im.h*scale)/2),scale);}
 G.bigText(comparison,1162,y+30,'REVISED BACK',[25,42,59]);const d=images[3];G.blitScaled(comparison,d,4*384,28,384,384,1152,y+46,1);
}
fs.writeFileSync(path.join(OUT,'form-pmd-comparison.png'),G.encodePng(comparison));
require('./build-eight-direction-roster').publish();
fs.writeFileSync(path.join(OUT,'form-pmd-validation.json'),JSON.stringify({passed:true,forms:ids.length,normalSheetsUnchanged:normals.length,sourceHashesVerified:true,cellSize:384,logicalDetailScale:2,method:'PMD native directional poses + pixel form parts'},null,2)+'\n');
console.log('Published PMD form revision; normal sheets unchanged: '+normals.length);
