#!/usr/bin/env node
'use strict';
// Reproducible release entry point: native poses, source parts, preserved eyes,
// then publish only after all seven staged forms and source hashes validate.
const path=require('path'),{spawnSync}=require('child_process');
function run(file,args=[]){const r=spawnSync(process.execPath,[path.join(__dirname,file),...args],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
if(!process.argv.includes('--publish-only')){run('build-venusaur-reference-eyes.js');for(const id of ['0006_charizard-gmax','0006_charizard-mega-x','0006_charizard-mega-y','0009_blastoise-gmax','0009_blastoise-mega'])run('build-pmd-form-reference.js',['--id',id]);}
run('publish-pmd-form-reference.js');run('validate-eight-direction-assets.js');
