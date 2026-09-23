import {initializeApp, cert, getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore, FieldPath} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {VERSION, people, trucks, questions, transition} from '../shared/flow.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }
});

const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const publicRecord = r => {
  const {owner_uid, event_ids, ...rest} = r;
  return rest;
};

function services() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      fail(503, 'La plataforma aún no está conectada. No iniciar la actividad.');
    }
    const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (credentials.project_id !== 'proclean-supersucker') {
      fail(503, 'Configuración del proyecto incorrecta.');
    }
    initializeApp({credential: cert(credentials)});
  }
  return {auth: getAuth(), db: getFirestore()};
}

export async function route(req, {auth, db}, env = process.env) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api/, '');
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  
  if (!token) fail(401, 'La sesión no está disponible. Recarga e inténtalo nuevamente.');
  let user;
  try {
    user = await auth.verifyIdToken(token, true);
  } catch {
    fail(401, 'La sesión venció. Recarga e inténtalo nuevamente.');
  }

  const admin = (env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(user.uid) && user.firebase?.sign_in_provider !== 'anonymous';
  const now = new Date().toISOString();

  if (path === '/catalog' && req.method === 'GET') {
    return json({people, trucks, admin, enabled: env.OPERATIONS_ENABLED === 'true', version: VERSION});
  }

  if (path.startsWith('/admin')) {
    if (!admin) fail(403, 'Acceso restringido a administración.');
    if (req.method !== 'GET' || path !== '/admin/records') fail(404, 'Ruta no encontrada.');
    const start = url.searchParams.get('start'), end = url.searchParams.get('end');
    if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 32 * 86400000) {
      fail(400, 'Selecciona un intervalo de hasta 31 días.');
    }
    let query = db.collection('consultations').where('started_at', '>=', start).where('started_at', '<', end).orderBy('started_at').orderBy(FieldPath.documentId()).limit(200);
    const cursor = url.searchParams.get('cursor');
    if (cursor) {
      let c;
      try {
        c = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        fail(400, 'Página no válida.');
      }
      if (!Array.isArray(c) || c.length !== 2 || !c.every(v => typeof v === 'string' && v.length < 100)) {
        fail(400, 'Página no válida.');
      }
      query = query.startAfter(...c);
    }
    const result = await query.get();
    const records = result.docs.map(d => {
      const r = publicRecord(d.data());
      if (r.cmz) {
        r.cmz = {...r.cmz};
        delete r.cmz.signature;
      }
      return r;
    });
    return json({
      records,
      cursor: result.size === 200 ? Buffer.from(JSON.stringify([result.docs.at(-1).data().started_at, result.docs.at(-1).id])).toString('base64url') : null
    });
  }

  const match = path.match(/^\/consultations(?:\/([a-f0-9-]{36}))?$/);
  if (!match) fail(404, 'Ruta no encontrada.');
  if (match[1] && req.method === 'GET') {
    const doc = await db.collection('consultations').doc(match[1]).get();
    if (!doc.exists || (!admin && doc.data().owner_uid !== user.uid)) {
      fail(404, 'Consulta no encontrada para esta sesión.');
    }
    return json(publicRecord(doc.data()));
  }

  if (!['POST', 'PATCH'].includes(req.method)) fail(405, 'Método no permitido.');
  if (env.OPERATIONS_ENABLED !== 'true') fail(503, 'Plataforma pendiente de habilitación operacional. No iniciar.');

  const raw = await req.text();
  if (raw.length > 180000) fail(413, 'Solicitud demasiado grande.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail(400, 'Solicitud no válida.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Solicitud no válida.');
  const id = match[1] || body.id;
  if (!/^[a-f0-9-]{36}$/.test(id || '')) fail(400, 'Identificador no válido.');

  const ref = db.collection('consultations').doc(id);

  if (req.method === 'POST' && !match[1]) {
    const person = people.find(p => p.id === body.operatorId), truck = trucks.find(t => t.id === body.truckId);
    if (!person || !truck) fail(400, 'Selecciona operador y patente.');
    const r = await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists) {
        const prev = previous.data();
        if (prev.owner_uid !== user.uid || prev.operator_id !== person.id || prev.truck_id !== truck.id) {
          fail(409, 'Identificador ya utilizado.');
        }
        return prev;
      }
      const rateRef = db.collection('session_limits').doc(user.uid);
      const rate = await tx.get(rateRef);
      const window = Math.floor(Date.now() / 3600000);
      const count = rate.exists && rate.data().window === window ? rate.data().count : 0;
      if (count >= 30) fail(429, 'Demasiadas consultas en esta sesión. Informa al responsable.');
      const rec = {
        id,
        owner_uid: user.uid,
        operator_id: person.id,
        operator_name: person.name,
        truck_id: truck.id,
        plate: truck.plate,
        rule_version: VERSION,
        started_at: now,
        ended_at: null,
        status: 'in_progress',
        answers: {},
        events: [],
        result: null,
        event_ids: {}
      };
      tx.set(ref, rec);
      tx.set(rateRef, {window, count: count + 1});
      return rec;
    });
    return json(publicRecord(r), 201);
  }

  if (req.method !== 'PATCH' || !match[1]) fail(405, 'Método no permitido.');
  if (!/^[a-f0-9-]{36}$/.test(body.eventId || '')) fail(400, 'Evento no válido.');
  const fingerprint = hash(body);

  const updated = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().owner_uid !== user.uid) {
      fail(404, 'Consulta no encontrada para esta sesión.');
    }
    const r = snap.data();
    if (r.event_ids[body.eventId]) {
      if (r.event_ids[body.eventId] !== fingerprint) fail(409, 'El evento ya se utilizó con otra respuesta.');
      return r;
    }
    if (r.rule_version !== VERSION) fail(409, 'Cambió el procedimiento. Inicia una nueva consulta.');
    if (body.kind !== 'abandon' && Date.now() - Date.parse(r.started_at) > 2 * 3600000) {
      fail(409, 'La consulta venció. Inicia una nueva consulta.');
    }
    let next;
    try {
      next = transition(r, body, now);
    } catch (e) {
      fail(400, e.message);
    }
    next.events.push({
      eventId: body.eventId,
      kind: body.kind,
      question: body.question || null,
      question_text: questions[body.question] || body.kind,
      answer: body.answer || null,
      at: now
    });
    next.event_ids[body.eventId] = fingerprint;
    if (next.cmz) {
      next.evidence_hash = hash({
        id: next.id,
        operator: next.operator_name,
        plate: next.plate,
        answers: next.answers,
        version: next.rule_version,
        cmz: next.cmz
      });
    }
    tx.set(ref, next);
    return next;
  });
  return json(publicRecord(updated));
}

// Universal handler compatible with both Web API Request/Response and Node (req, res)
export default async function handler(req, res) {
  try {
    if (res && typeof res.status === 'function') {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const fullUrl = `${proto}://${host}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach(item => headers.append(k, item));
        else if (v !== undefined) headers.set(k, String(v));
      }
      let body;
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (typeof req.body === 'string') {
          body = req.body;
        } else if (req.body && typeof req.body === 'object') {
          body = JSON.stringify(req.body);
        }
      }
      const webReq = new Request(fullUrl, {
        method: req.method,
        headers,
        body
      });
      const response = await route(webReq, services());
      res.status(response.status);
      response.headers.forEach((v, k) => res.setHeader(k, v));
      const text = await response.text();
      return res.send(text);
    }
    return await route(req, services());
  } catch (e) {
    const errorMsg = e.status ? e.message : 'No se pudo guardar o consultar el registro. Reintenta; no inicies sin confirmación.';
    const statusCode = e.status || 500;
    if (res && typeof res.status === 'function') {
      return res.status(statusCode).json({error: errorMsg});
    }
    return json({error: errorMsg}, statusCode);
  }
}
