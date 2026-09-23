import {operatorSession,api} from './session.js';
import {materials,questions,nextQuestion,DECLARATION,VERSION,validateSignature} from '../shared/flow.js';
import {signaturePad} from './signature.js';
import campaign from './yo-digo-no.png';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',dateStyle:'short',timeStyle:'medium'}).format(new Date(s));
let catalog,person='',truck='',record=null,startId=null,busy=false,pending=null,pad=null,draft={};
function saveDraft(){if($('#cmz-name'))draft={name:$('#cmz-name').value,identifier:$('#cmz-id').value,material:$('#specific').value,pickup:$('#pickup').value,accepted:$('#accept').checked,signature:pad?.get()||[]};}
async function run(fn){if(busy)return;busy=true;$('#error').hidden=true;document.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);try{await fn();render();$('#question')?.focus();}catch(e){$('#error').textContent=e.message;$('#error').hidden=false;}finally{busy=false;document.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);if($('#next'))$('#next').disabled=!$('#pick')?.value;}}
const button=(v,t,sub='',danger=false)=>`<button class="choice ${danger?'danger':''}" data-answer="${v}">${t}${sub?`<span>${sub}</span>`:''}</button>`;
function render(){
 pad?.destroy();pad=null;const screen=$('#screen');screen.className='';
 $('#identity').hidden=!record;$('#identity').textContent=record?`${record.operator_name} · ${record.plate}`:'';
 $('#connection').hidden=catalog?.enabled===true;$('#connection').textContent='Configuración pendiente · no habilitado para operar';
 if(!catalog){screen.innerHTML='<h1 id="question" tabindex="-1">No se pudo conectar</h1><button id="retry" class="continue">REINTENTAR</button>';$('#retry').onclick=()=>run(load);return;}
 if(!record){const isPerson=!person;$('#progress').textContent=isPerson?'Paso 1 · Operador':'Paso 2 · Camión';
  screen.innerHTML=`<h1 id="question" tabindex="-1">${isPerson?'¿Quién eres?':'¿Qué camión usarás?'}</h1><label for="pick">${isPerson?'Tu nombre':'Patente'}</label><select id="pick"><option value="">Selecciona una opción</option>${(isPerson?catalog.people:catalog.trucks).map(r=>`<option value="${r.id}">${esc(r.name||r.plate)}</option>`).join('')}</select><button id="next" class="continue" disabled>CONTINUAR →</button><p class="secondary">${isPerson?'Selecciona tu propio nombre.':'El área se selecciona en el siguiente paso, independiente de la patente.'}</p>`;
  $('#pick').value=isPerson?person:truck;$('#pick').onchange=()=>{$('#next').disabled=!$('#pick').value;if(!isPerson){truck=$('#pick').value;startId=null;}};
  $('#next').onclick=()=>run(async()=>{if(isPerson)person=$('#pick').value;else{truck=$('#pick').value;startId??=crypto.randomUUID();record=await api('/consultations','POST',{id:startId,operatorId:person,truckId:truck});}});return;
 }
 if(['blocked','approved'].includes(record.status)){
  const green=record.status==='approved',r=record.result;screen.className='result '+(green?'green':'red');$('#progress').textContent='Resultado registrado';
  screen.innerHTML=`${green?'<div class="signal">✓</div>':`<img class="campaign-logo" src="${campaign}" alt="Yo digo no · Zaldívar">`}<div class="card-label">TARJETA ${green?'VERDE':'ROJA'}</div><h1 id="question" tabindex="-1">${green?'PUEDE INICIAR':'NO INICIAR'}</h1><p class="result-detail">${esc(r.detail)}</p><div class="action">${esc(r.action)}</div>${green?`<p>Respaldo CMZ: ${esc(record.cmz.name)}<br>Material: ${esc(record.cmz.material)}<br>Punto: ${esc(record.cmz.pickup)}</p>`:''}<div class="receipt">Guardado · ${time(record.ended_at)}<br>Folio: ${esc(record.id)}</div><p class="secondary">Válido únicamente para esta consulta y las condiciones declaradas. Si cambian, realiza una nueva evaluación.</p><button class="choice full" id="new">NUEVA CONSULTA</button>`;$('#new').onclick=()=>run(reset);return;
 }
 if(record.status==='pending_cmz'){renderCMZ();return;}
 const a=record.answers,key=nextQuestion(a);$('#progress').textContent=`Paso ${key==='area'?3:a.area==='dry'?4:{material:4,identified:5,clean:6,epp:7}[key]}`;
 let help='',buttons='';
 if(key==='area'){help='Elige el área de esta tarea.';buttons=button('dry','ÁREA SECA','Material no líquido')+button('wet','ÁREA HÚMEDA','Material líquido');}
 if(key==='material'){help='Una sola sustancia. Si tienes dudas, elige «No sé / otro».';buttons=Object.entries(materials).map(([v,t])=>button(v,t.toUpperCase(),v==='ox'?'También si sospechas su presencia':'',['ox','mixed','unknown'].includes(v))).join('');}
 if(key==='identified'){help='Origen y producto verificados: una sola sustancia, sin mezcla ni sospecha de OXILIX.';buttons=button('yes','SÍ, ESTÁ CONFIRMADO')+button('no','NO / NO SÉ','',true);}
 if(key==='clean'){help='Tolva y mangueras sin residuos de la carga anterior, según el procedimiento de limpieza.';buttons=button('yes','SÍ, ESTÁ LIMPIO Y APTO')+button('no','NO / NO SÉ','',true);}
 if(key==='epp'){help='Completo y en buen estado. Úsalo durante la tarea.';buttons=button('yes','SÍ, CUENTO CON ÉL')+button('no','NO / ME FALTA / NO SÉ','',true);}
 screen.innerHTML=`${a.area?`<div class="context">${a.area==='dry'?'ÁREA SECA':'ÁREA HÚMEDA'} ${a.material?'· '+materials[a.material]:''}</div>`:''}<h1 id="question" tabindex="-1">${questions[key]}</h1><p>${help}</p><div class="choices">${buttons}</div>`;
 screen.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>run(async()=>{if(!pending||pending.question!==key||pending.answer!==b.dataset.answer)pending={eventId:crypto.randomUUID(),kind:'answer',question:key,answer:b.dataset.answer};record=await api('/consultations/'+record.id,'PATCH',pending);pending=null;}));
}
function renderCMZ(){
 $('#progress').textContent='Último paso · Respaldo de CMZ';const screen=$('#screen');screen.className='pending';
 screen.innerHTML=`<h1 id="question" tabindex="-1">Falta el respaldo de CMZ</h1><p>No iniciar todavía. Entrega el celular a quien solicita la actividad por CMZ.</p><div class="summary"><b>${esc(record.operator_name)} · ${esc(record.plate)}</b><br>${record.answers.area==='dry'?'Área seca · material no líquido':'Área húmeda · '+materials[record.answers.material]}<br>EPP confirmado${record.answers.area==='wet'?' · Contenido confirmado · Equipo limpio y apto':''}</div><form id="cmz-form"><label for="specific">Material específico a aspirar</label><input id="specific" required maxlength="180" value="${esc(draft.material||'')}" placeholder="Nombre del material o producto"><label for="pickup">Punto de aspiración</label><input id="pickup" required maxlength="180" value="${esc(draft.pickup||'')}" placeholder="Sector y equipo o punto"><label for="cmz-name">Nombre completo de quien solicita por CMZ</label><input id="cmz-name" required minlength="5" maxlength="100" autocomplete="name" value="${esc(draft.name||'')}"><label for="cmz-id">Identificador de CMZ (credencial o RUT)</label><input id="cmz-id" required minlength="3" maxlength="50" value="${esc(draft.identifier||'')}"><label class="accept"><input id="accept" type="checkbox" required ${draft.accepted?'checked':''}>${DECLARATION}</label><label for="signature">Firma de quien solicita por CMZ</label><p class="signature-help">Firma con el dedo dentro del recuadro.</p><canvas id="signature" aria-label="Recuadro de firma de CMZ"></canvas><button type="button" id="clear" class="back">Borrar firma</button><p class="secondary">Al confirmar se guardarán esta declaración, firma y los datos de esta consulta. La firma registra el respaldo declarado; no reemplaza los controles operacionales.</p><button class="continue" type="submit">FIRMAR Y GUARDAR RESPALDO</button></form>`;
 pad=signaturePad($('#signature'),draft.signature||[]);$('#clear').onclick=()=>pad.clear();
 $('#cmz-form').onsubmit=e=>{e.preventDefault();saveDraft();run(async()=>{validateSignature(draft.signature);const payload={kind:'sign',...draft,declaration:DECLARATION,version:VERSION};const serialized=JSON.stringify(payload);if(pending?.serialized!==serialized)pending={serialized,eventId:crypto.randomUUID()};record=await api('/consultations/'+record.id,'PATCH',{...payload,eventId:pending.eventId});pending=null;draft={};});};
}
async function reset(){if(record&&['in_progress','pending_cmz'].includes(record.status)){await api('/consultations/'+record.id,'PATCH',{eventId:crypto.randomUUID(),kind:'abandon'});}record=null;person='';truck='';startId=null;pending=null;draft={};}
async function load(){await operatorSession();catalog=await api('/catalog');}
$('#restart').onclick=()=>{saveDraft();run(reset);};
window.addEventListener('offline',()=>{$('#error').textContent='Sin conexión. No iniciar hasta guardar y recibir la confirmación.';$('#error').hidden=false;});
run(async()=>{try{await load();}catch(e){render();throw e;}});
