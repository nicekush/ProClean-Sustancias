import {adminLogin,api,logout} from './session.js';
import {signaturePad} from './signature.js';
import {questions,materials} from '../shared/flow.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let rows=[],cursor=null,filter='',busy=false,pad;
const names={approved:'Verde · respaldo CMZ',blocked:'Roja · no iniciar',pending_cmz:'Pendiente de CMZ',in_progress:'En curso',abandoned:'Abandonada'};
const time=s=>s?new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',dateStyle:'short',timeStyle:'medium'}).format(new Date(s)):'';
const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
// Convert a Chilean calendar midnight to UTC, accounting for daylight saving.
function chileMidnight(date){let t=Date.parse(date+'T00:00:00Z');for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);t+=Date.parse(date+'T00:00:00Z')-local;}return new Date(t).toISOString();}
async function run(fn){if(busy)return;busy=true;$('#error').hidden=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('#error').textContent=e.message;$('#error').hidden=false;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('#export').disabled=!rows.length;}}
$('#from').value=day(new Date());$('#to').value=day(new Date());
$('#login-form').onsubmit=e=>{e.preventDefault();run(async()=>{await adminLogin($('#email').value,$('#password').value);$('#password').value='';const c=await api('/catalog');if(!c.admin){await logout();throw Error('Esta cuenta no tiene permisos de administración.');}$('#login').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;await load(true);});};
$('#logout').onclick=()=>run(async()=>{await logout();location.reload();});
$('#filters').onsubmit=e=>{e.preventDefault();run(()=>load(true));};$('#more').onclick=()=>run(()=>load(false));
async function load(reset){
 if(reset){const start=chileMidnight($('#from').value);const next=new Date($('#to').value+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);const end=chileMidnight(next.toISOString().slice(0,10));filter=new URLSearchParams({start,end}).toString();rows=[];cursor=null;$('#detail').hidden=true;render();}
 const data=await api('/admin/records?'+filter+(cursor?'&cursor='+encodeURIComponent(cursor):''));rows.push(...data.records);cursor=data.cursor;render();
}
function render(){
 $('#count').textContent=`${rows.length} consultas cargadas.${cursor?' Hay más resultados: carga todas las páginas para completar los indicadores y la exportación.':''}`;
 const counts=Object.fromEntries(Object.keys(names).map(k=>[k,rows.filter(r=>r.status===k).length]));
 $('#metrics').innerHTML=Object.entries(names).map(([k,n])=>`<div class="metric metric-${k}"><span class="metric-title">${n}</span><b>${counts[k]}</b></div>`).join('')+`<div class="metric metric-ratio"><span class="metric-title">% bloqueadas sobre finalizadas</span><b>${counts.approved+counts.blocked?Math.round(100*counts.blocked/(counts.approved+counts.blocked)):0}%</b></div>`;
 $('#rows').innerHTML=rows.map(r=>`<tr><td><span class="cell-date">${time(r.started_at)}</span></td><td><b>${esc(r.operator_name)}</b></td><td><span class="badge-plate">${esc(r.plate)}</span></td><td>${r.answers.area==='wet'?'<span class="badge-area wet">Húmeda</span>':r.answers.area==='dry'?'<span class="badge-area dry">Seca</span>':'—'}</td><td><span class="status-pill status-${r.status}">${names[r.status]}</span></td><td><button class="btn-table" data-id="${r.id}">Ver registro</button></td></tr>`).join('');$('#more').hidden=!cursor;
 document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>run(async()=>{const r=await api('/consultations/'+b.dataset.id);pad?.destroy();$('#detail').hidden=false;$('#detail').innerHTML=`<h2>Registro ${esc(r.id)}</h2><p>${esc(r.operator_name)} · ${esc(r.plate)} · ${names[r.status]}</p><dl class="summary">${r.events.map(e=>`<dt>${esc(e.question_text)}</dt><dd>${esc(materials[e.answer]||({yes:'Sí',no:'No / no sé',dry:'Área seca',wet:'Área húmeda'}[e.answer])||e.kind)} · ${time(e.at)}</dd>`).join('')}</dl>${r.cmz?`<h2>Respaldo de CMZ</h2><p>${esc(r.cmz.name)} · ${esc(r.cmz.identifier)}</p><p>Material: ${esc(r.cmz.material)}<br>Punto: ${esc(r.cmz.pickup)}</p><p>${esc(r.cmz.declaration)}</p><canvas id="saved-signature" aria-label="Firma registrada"></canvas><p>${time(r.cmz.signed_at)}</p><p class="secondary">Huella de evidencia: ${esc(r.evidence_hash)}</p>`:''}<p>Versión del flujo: ${esc(r.rule_version)}</p>`;if(r.cmz){pad=signaturePad($('#saved-signature'),r.cmz.signature);const c=$('#saved-signature');c.onpointerdown=c.onpointermove=c.onpointerup=c.onpointercancel=null;}$('#detail').scrollIntoView({behavior:'smooth'});}));
}
function csvCell(v){let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
$('#export').onclick=()=>{
 const header=['Folio','Inicio Chile','Fin Chile','Operador','Patente','Área','Sustancia','Contenido confirmado','Limpio y apto','EPP','Estado','Motivo','CMZ nombre','CMZ identificador','Material específico','Punto aspiración','Firma fecha Chile','Versión','Huella evidencia','Preguntas y respuestas'];
 const data=rows.map(r=>[r.id,time(r.started_at),time(r.ended_at),r.operator_name,r.plate,r.answers.area,materials[r.answers.material]||'',r.answers.identified,r.answers.clean,r.answers.epp,names[r.status],r.result?.reason,r.cmz?.name,r.cmz?.identifier,r.cmz?.material,r.cmz?.pickup,time(r.cmz?.signed_at),r.rule_version,r.evidence_hash,JSON.stringify(r.events)]);
 const blob=new Blob(['\ufeff'+[header,...data].map(row=>row.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`proclean-${$('#from').value}-${$('#to').value}${cursor?'-PARCIAL':''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
