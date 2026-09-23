import test from 'node:test';
import assert from 'node:assert/strict';
import {transition,evaluate,VERSION,DECLARATION} from '../shared/flow.js';
const now='2026-09-23T13:00:00.000Z';
const blank=()=>({status:'in_progress',answers:{},result:null,rule_version:VERSION});
const answer=(r,q,a)=>transition(r,{kind:'answer',question:q,answer:a},now);
const signature=[Array.from({length:12},(_,i)=>[.1+i*.04,.2+(i%3)*.08])];
const sign={kind:'sign',name:'Responsable CMZ',identifier:'CMZ-123',material:'Material identificado',pickup:'Punto 123',accepted:true,declaration:DECLARATION,version:VERSION,signature};
test('Water, acid and acidulated require every control and CMZ signature',()=>{
 for(const material of ['water','acid','acidulated']){
  let r=blank();for(const [q,a] of Object.entries({area:'wet',material,identified:'yes',clean:'yes',epp:'yes'})){r=answer(r,q,a);assert.notEqual(r.result?.color,'green');}
  assert.equal(r.status,'pending_cmz');assert.throws(()=>transition(r,{...sign,accepted:false},now));assert.throws(()=>transition(r,{...sign,signature:[]},now));
  r=transition(r,sign,now);assert.equal(r.status,'approved');assert.equal(r.result.color,'green');assert.equal(r.cmz.signed_at,now);assert.throws(()=>answer(r,'material','ox'));assert.throws(()=>transition(r,sign,now));
 }
});
test('OXILIX is blocked and cannot be signed, regardless of other values',()=>{
 for(const area of ['wet','dry'])for(const epp of ['yes','no'])assert.equal(evaluate({area,material:'ox',identified:'yes',clean:'yes',epp}).color,'red');
 let r=answer(answer(blank(),'area','wet'),'material','ox');assert.equal(r.status,'blocked');assert.throws(()=>transition(r,sign,now));
});
test('All 48 wet material/control combinations have no green without signing',()=>{
 for(const material of ['water','acid','acidulated','mixed','unknown','ox'])for(const identified of ['yes','no'])for(const clean of ['yes','no'])for(const epp of ['yes','no']){
  const r=evaluate({area:'wet',material,identified,clean,epp});assert.notEqual(r?.color,'green');assert.equal(r.color,['water','acid','acidulated'].includes(material)&&[identified,clean,epp].every(a=>a==='yes')?'amber':'red');
 }
});
test('Dry area goes straight to EPP, then CMZ; cannot skip questions or add liquids',()=>{
 let r=answer(blank(),'area','dry');assert.throws(()=>answer(r,'material','water'));assert.throws(()=>transition(r,sign,now));assert.equal(answer(r,'epp','no').status,'blocked');r=answer(r,'epp','yes');assert.equal(r.status,'pending_cmz');assert.equal(transition(r,sign,now).status,'approved');
 assert.throws(()=>answer(blank(),'clean','yes'));assert.throws(()=>answer(blank(),'area','unknown'));
});
test('Abandoning pending evidence never yields permission',()=>{
 const r=answer(answer(blank(),'area','dry'),'epp','yes');const next=transition(r,{kind:'abandon'},now);assert.equal(next.status,'abandoned');assert.equal(next.result,null);assert.throws(()=>transition(next,sign,now));
});
