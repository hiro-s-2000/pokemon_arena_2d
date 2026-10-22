'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../確認用画像/pokeSprite-smooth-review');
const c=JSON.parse(fs.readFileSync(path.join(OUT,'catalog.json'))),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(c.records.length,16);let sheets=0,cells=0;const records=[],unavailableHistoricalSources=[];
for(const r of c.records){const v=JSON.parse(fs.readFileSync(path.join(OUT,r.id,'validation.json')));assert(v.passed);assert.equal(new Set(v.idleDirectionHashes).size,8);
 for(const [name,a]of Object.entries(r.anims)){const b=fs.readFileSync(path.join(OUT,r.id,a.file));assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),a.fw*a.frames);assert.equal(b.readUInt32BE(20),a.fh*a.rows);assert.equal(a.rows,8);assert.equal(a.durations.length,a.frames);
  const rows=v.rows.find(x=>x.action===name).rows;assert.equal(rows.length,8);for(const row of rows){const bounds=row.bounds||row.steps.map(s=>s.bounds);assert.equal(bounds.length,a.frames);assert(row.uniqueFrames>=2);for(const q of bounds)assert(q.x0>=2&&q.y0>=2&&q.x1<a.fw-2&&q.y1<a.fh-2&&q.w>0&&q.h>0);}
  sheets++;cells+=a.frames*a.rows;
 }
 for(const s of r.sources){const f=path.resolve(ROOT,s.file);if(!fs.existsSync(f)){unavailableHistoricalSources.push({id:r.id,file:s.file});continue;}assert.equal(hash(fs.readFileSync(f)),s.sha256,r.id+' source changed');}
 records.push({id:r.id,sourceMethod:r.sourceMethod,sourceFaintRows:r.anims.Faint.sourceRows,passed:true});
}
for(const n of ['Idle','Walk','Attack','Hurt','Faint'])assert.equal(hash(fs.readFileSync(path.join(OUT,'0001_bulbasaur',n+'.png'))),hash(fs.readFileSync(path.join(OUT,'bulbasaur-eight-directions',n+'.png'))),'Approved Bulbasaur differs');
const result={passed:true,entries:c.records.length,sheets,cells,sourceHashesUnchanged:unavailableHistoricalSources.length?null:true,availableSourceHashesPassed:true,unavailableHistoricalSources,approvedBulbasaurExact:true,dimensionsPassed:true,recordedBoundsPassed:true,records};
fs.writeFileSync(path.join(OUT,'asset-validation.json'),JSON.stringify(result,null,2)+'\n');console.log({passed:true,entries:c.records.length,sheets,cells,availableSourceHashesPassed:true,unavailableHistoricalSources:unavailableHistoricalSources.length,approvedBulbasaurExact:true});
