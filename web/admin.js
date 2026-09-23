import {adminLogin, api, logout} from './session.js';
import {signaturePad} from './signature.js';
import {questions, materials} from '../shared/flow.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

let rows = [], cursor = null, filter = '', busy = false, pad;
let currentFleet = { people: [], trucks: [] };

const names = {
  approved: 'Verde · respaldo CMZ',
  blocked: 'Roja · no iniciar',
  pending_cmz: 'Pendiente de CMZ',
  in_progress: 'En curso',
  abandoned: 'Abandonada'
};

const time = s => s ? new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  dateStyle: 'short',
  timeStyle: 'medium'
}).format(new Date(s)) : '';

const day = d => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(d);

function chileMidnight(date) {
  let t = Date.parse(date + 'T00:00:00Z');
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(t));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    t += Date.parse(date + 'T00:00:00Z') - local;
  }
  return new Date(t).toISOString();
}

async function run(fn) {
  if (busy) return;
  busy = true;
  $('#error').hidden = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    await fn();
  } catch (e) {
    $('#error').textContent = e.message;
    $('#error').hidden = false;
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(b => b.disabled = false);
    if ($('#export')) $('#export').disabled = !rows.length;
  }
}

// Initialize Dates
if ($('#from')) $('#from').value = day(new Date());
if ($('#to')) $('#to').value = day(new Date());

// Login
$('#login-form').onsubmit = e => {
  e.preventDefault();
  run(async () => {
    await adminLogin($('#email').value, $('#password').value);
    $('#password').value = '';
    const c = await api('/catalog');
    if (!c.admin) {
      await logout();
      throw Error('Esta cuenta no tiene permisos de administración.');
    }
    $('#login').hidden = true;
    $('#dashboard').hidden = false;
    $('#logout').hidden = false;
    await load(true);
    await loadFleet();
  });
};

$('#logout').onclick = () => run(async () => {
  await logout();
  location.reload();
});

// Tab Switcher
$('#tab-analytics').onclick = () => {
  $('#tab-analytics').classList.add('active');
  $('#tab-fleet').classList.remove('active');
  $('#view-analytics').hidden = false;
  $('#view-fleet').hidden = true;
};

$('#tab-fleet').onclick = () => {
  $('#tab-fleet').classList.add('active');
  $('#tab-analytics').classList.remove('active');
  $('#view-fleet').hidden = false;
  $('#view-analytics').hidden = true;
  run(loadFleet);
};

// Filters and Pagination
$('#filters').onsubmit = e => {
  e.preventDefault();
  run(() => load(true));
};

$('#more').onclick = () => run(() => load(false));

async function load(reset) {
  if (reset) {
    const start = chileMidnight($('#from').value);
    const next = new Date($('#to').value + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const end = chileMidnight(next.toISOString().slice(0, 10));
    filter = new URLSearchParams({start, end}).toString();
    rows = [];
    cursor = null;
    $('#detail').hidden = true;
    render();
  }
  const data = await api('/admin/records?' + filter + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
  rows.push(...data.records);
  cursor = data.cursor;
  render();
}

function render() {
  $('#count').textContent = `${rows.length} consultas cargadas.${cursor ? ' Hay más resultados: carga todas las páginas para completar los indicadores y la exportación.' : ''}`;
  const counts = Object.fromEntries(Object.keys(names).map(k => [k, rows.filter(r => r.status === k).length]));
  
  $('#metrics').innerHTML = Object.entries(names).map(([k, n]) => `
    <div class="metric metric-${k}">
      <span class="metric-title">${n}</span>
      <b>${counts[k]}</b>
    </div>
  `).join('') + `
    <div class="metric metric-ratio">
      <span class="metric-title">% bloqueadas sobre finalizadas</span>
      <b>${counts.approved + counts.blocked ? Math.round(100 * counts.blocked / (counts.approved + counts.blocked)) : 0}%</b>
    </div>
  `;

  $('#rows').innerHTML = rows.map(r => `
    <tr>
      <td><span class="cell-date">${time(r.started_at)}</span></td>
      <td><b>${esc(r.operator_name)}</b></td>
      <td><span class="badge-plate">${esc(r.plate)}</span></td>
      <td>${r.answers.area === 'wet' ? '<span class="badge-area wet">Húmeda</span>' : r.answers.area === 'dry' ? '<span class="badge-area dry">Seca</span>' : '—'}</td>
      <td><span class="status-pill status-${r.status}">${names[r.status]}</span></td>
      <td><button class="btn-table" data-id="${r.id}">Ver registro</button></td>
    </tr>
  `).join('');

  $('#more').hidden = !cursor;

  document.querySelectorAll('[data-id]').forEach(b => b.onclick = () => run(async () => {
    const r = await api('/consultations/' + b.dataset.id);
    pad?.destroy();
    $('#detail').hidden = false;
    $('#detail').innerHTML = `
      <h2>Registro ${esc(r.id)}</h2>
      <p><b>${esc(r.operator_name)}</b> · Patente <span class="badge-plate">${esc(r.plate)}</span> · <span class="status-pill status-${r.status}">${names[r.status]}</span></p>
      <dl class="summary">
        ${r.events.map(e => `
          <dt>${esc(e.question_text)}</dt>
          <dd>${esc(materials[e.answer] || ({yes: 'Sí', no: 'No / no sé', dry: 'Área seca', wet: 'Área húmeda'}[e.answer]) || e.kind)} · ${time(e.at)}</dd>
        `).join('')}
      </dl>
      ${r.cmz ? `
        <h2>Respaldo de CMZ</h2>
        <p><b>${esc(r.cmz.name)}</b> (ID: ${esc(r.cmz.identifier)})</p>
        <p>Material específico: <b>${esc(r.cmz.material)}</b><br>Punto de aspiración: <b>${esc(r.cmz.pickup)}</b></p>
        <p class="secondary">${esc(r.cmz.declaration)}</p>
        <label>Firma digital registrada:</label>
        <canvas id="saved-signature" aria-label="Firma registrada"></canvas>
        <p class="secondary">Firmado: ${time(r.cmz.signed_at)}</p>
        <div class="detail-hash">Huella SHA-256 de evidencia: ${esc(r.evidence_hash)}</div>
      ` : ''}
      <p class="secondary" style="margin-top: 14px;">Versión de reglas: ${esc(r.rule_version)}</p>
    `;

    if (r.cmz) {
      pad = signaturePad($('#saved-signature'), r.cmz.signature);
      const c = $('#saved-signature');
      c.onpointerdown = c.onpointermove = c.onpointerup = c.onpointercancel = null;
    }
    $('#detail').scrollIntoView({behavior: 'smooth'});
  }));
}

// CSV Export for Excel
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

$('#export').onclick = () => {
  const header = ['Folio', 'Inicio Chile', 'Fin Chile', 'Operador', 'Patente', 'Área', 'Sustancia', 'Contenido confirmado', 'Limpio y apto', 'EPP', 'Estado', 'Motivo', 'CMZ nombre', 'CMZ identificador', 'Material específico', 'Punto aspiración', 'Firma fecha Chile', 'Versión', 'Huella evidencia', 'Preguntas y respuestas'];
  const data = rows.map(r => [
    r.id,
    time(r.started_at),
    time(r.ended_at),
    r.operator_name,
    r.plate,
    r.answers.area,
    materials[r.answers.material] || '',
    r.answers.identified,
    r.answers.clean,
    r.answers.epp,
    names[r.status],
    r.result?.reason,
    r.cmz?.name,
    r.cmz?.identifier,
    r.cmz?.material,
    r.cmz?.pickup,
    time(r.cmz?.signed_at),
    r.rule_version,
    r.evidence_hash,
    JSON.stringify(r.events)
  ]);
  const blob = new Blob(['\ufeff' + [header, ...data].map(row => row.map(csvCell).join(';')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = `proclean-${$('#from').value}-${$('#to').value}${cursor ? '-PARCIAL' : ''}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ==========================================
// GESTIÓN DE FLOTA (OPERADORES Y PATENTES)
// ==========================================

async function loadFleet() {
  const data = await api('/admin/catalog');
  currentFleet = data;
  renderFleet();
}

function renderFleet() {
  // Render Operators
  const people = currentFleet.people || [];
  $('#operators-count').textContent = `${people.length} registrados (${people.filter(p => p.active !== false).length} activos)`;
  
  if (!people.length) {
    $('#operators-list').innerHTML = '<p class="fleet-empty">No hay operadores registrados.</p>';
  } else {
    $('#operators-list').innerHTML = people.map(p => `
      <div class="fleet-item ${p.active === false ? 'inactive' : ''}">
        <div class="fleet-item-info">
          <span class="fleet-name">${esc(p.name)}</span>
          <span class="fleet-badge ${p.active === false ? 'badge-inactive' : 'badge-active'}">
            ${p.active === false ? 'Inactivo' : 'Activo'}
          </span>
        </div>
        <div class="fleet-item-actions">
          <button class="btn-fleet-toggle" data-person-toggle="${p.id}" data-active="${p.active !== false}">
            ${p.active === false ? 'Activar' : 'Desactivar'}
          </button>
          <button class="btn-fleet-delete" data-person-delete="${p.id}" title="Eliminar operador">
            ✕
          </button>
        </div>
      </div>
    `).join('');
  }

  // Render Trucks
  const trucks = currentFleet.trucks || [];
  $('#trucks-count').textContent = `${trucks.length} registrados (${trucks.filter(t => t.active !== false).length} activos)`;

  if (!trucks.length) {
    $('#trucks-list').innerHTML = '<p class="fleet-empty">No hay camiones registrados.</p>';
  } else {
    $('#trucks-list').innerHTML = trucks.map(t => `
      <div class="fleet-item ${t.active === false ? 'inactive' : ''}">
        <div class="fleet-item-info">
          <span class="badge-plate">${esc(t.plate)}</span>
          <span class="fleet-badge ${t.active === false ? 'badge-inactive' : 'badge-active'}">
            ${t.active === false ? 'Inactivo' : 'Activo'}
          </span>
        </div>
        <div class="fleet-item-actions">
          <button class="btn-fleet-toggle" data-truck-toggle="${t.id}" data-active="${t.active !== false}">
            ${t.active === false ? 'Activar' : 'Desactivar'}
          </button>
          <button class="btn-fleet-delete" data-truck-delete="${t.id}" title="Eliminar patente">
            ✕
          </button>
        </div>
      </div>
    `).join('');
  }

  // Bind Operator Toggle Buttons
  document.querySelectorAll('[data-person-toggle]').forEach(b => {
    b.onclick = () => run(async () => {
      const id = b.dataset.personToggle;
      const currentlyActive = b.dataset.active === 'true';
      await api('/admin/people/' + id, 'PATCH', { active: !currentlyActive });
      await loadFleet();
    });
  });

  // Bind Operator Delete Buttons
  document.querySelectorAll('[data-person-delete]').forEach(b => {
    b.onclick = () => run(async () => {
      const id = b.dataset.personDelete;
      const person = people.find(p => p.id === id);
      if (!confirm(`¿Estás seguro de eliminar al operador "${person?.name || id}"?`)) return;
      await api('/admin/people/' + id, 'DELETE');
      await loadFleet();
    });
  });

  // Bind Truck Toggle Buttons
  document.querySelectorAll('[data-truck-toggle]').forEach(b => {
    b.onclick = () => run(async () => {
      const id = b.dataset.truckToggle;
      const currentlyActive = b.dataset.active === 'true';
      await api('/admin/trucks/' + id, 'PATCH', { active: !currentlyActive });
      await loadFleet();
    });
  });

  // Bind Truck Delete Buttons
  document.querySelectorAll('[data-truck-delete]').forEach(b => {
    b.onclick = () => run(async () => {
      const id = b.dataset.truckDelete;
      const truck = trucks.find(t => t.id === id);
      if (!confirm(`¿Estás seguro de eliminar el camión con patente "${truck?.plate || id}"?`)) return;
      await api('/admin/trucks/' + id, 'DELETE');
      await loadFleet();
    });
  });
}

// Add Operator Form Submit
$('#form-add-operator').onsubmit = e => {
  e.preventDefault();
  const input = $('#new-operator-name');
  const name = input.value.trim();
  if (!name) return;
  run(async () => {
    await api('/admin/people', 'POST', { name });
    input.value = '';
    await loadFleet();
  });
};

// Add Truck Form Submit
$('#form-add-truck').onsubmit = e => {
  e.preventDefault();
  const input = $('#new-truck-plate');
  const plate = input.value.trim().toUpperCase();
  if (!plate) return;
  run(async () => {
    await api('/admin/trucks', 'POST', { plate });
    input.value = '';
    await loadFleet();
  });
};
