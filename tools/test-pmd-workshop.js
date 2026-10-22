// Integration checks: lossless export, isolated pixel edit, and invalid input rejection.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {build}=require('./pmd-workshop'),{decodePng}=require('./pixelize');
const source=path.resolve(__dirname,'../workshop/charizard-mega-x');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pmd-workshop-test-'));
try{
  fs.cpSync(source,temp,{recursive:true});
  const first=build(temp), project=JSON.parse(fs.readFileSync(path.join(temp,'project.json')));
  for(const[n,a]of Object.entries(project.anims)){
    assert.equal(first.metrics[n].changedPixels,0);
    const ref=decodePng(path.join(temp,'reference',n+'.png')),out=decodePng(path.join(temp,'build',n+'.png'));
    assert.equal(out.w,ref.w*project.scale);assert.equal(out.h,ref.h*project.scale);
    for(let y=0;y<out.h;y++)for(let x=0;x<out.w;x++){
      const i=(y*out.w+x)*4,j=(Math.floor(y/project.scale)*ref.w+Math.floor(x/project.scale))*4;
      for(let c=0;c<4;c++)assert.equal(out.data[i+c],ref.data[j+c]);
    }
  }
  const file=path.join(temp,'pixels/Idle/S-000.txt'),original=fs.readFileSync(file,'utf8');
  const i=[...original].findIndex(c=>c!=='.'&&c!=='\n'),old=original[i],replacement=Object.keys(project.palette).find(c=>project.palette[c]!==project.palette[old]);
  fs.writeFileSync(file,original.slice(0,i)+replacement+original.slice(i+1));
  const edited=build(temp);assert.equal(edited.metrics.Idle.changedPixels,1);
  for(const[n,m]of Object.entries(edited.metrics))if(n!=='Idle')assert.equal(m.changedPixels,0);
  fs.writeFileSync(file,original.slice(1));assert.throws(()=>build(temp),/grid size mismatch/);
  fs.writeFileSync(file,original.replace(old,'~'));assert.throws(()=>build(temp),/unknown colour/);
  fs.writeFileSync(file,original);project.anims.Idle.durations[0]=0;
  fs.writeFileSync(path.join(temp,'project.json'),JSON.stringify(project));assert.throws(()=>build(temp),/invalid durations/);
  console.log('PASS: all 560 source cells round-trip pixel-exactly; a 1px edit stays isolated; malformed grids, colours and durations rejected.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
