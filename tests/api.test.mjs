import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {route} from '../api/index.js';
import {DECLARATION, VERSION} from '../shared/flow.js';

function fixture() {
  const docs = new Map();
  const snap = key => ({
    exists: docs.has(key),
    data: () => structuredClone(docs.get(key))
  });

  const db = {
    collection: name => ({
      doc: id => ({
        key: name + '/' + id,
        get: async () => snap(name + '/' + id),
        set: async (data, opts) => {
          const prev = docs.get(name + '/' + id) || {};
          docs.set(name + '/' + id, opts?.merge ? { ...prev, ...data } : structuredClone(data));
        },
        delete: async () => docs.delete(name + '/' + id)
      }),
      get: async () => {
        const d = [];
        for (const [k, v] of docs.entries()) {
          if (k.startsWith(name + '/')) {
            d.push({ id: k.slice(name.length + 1), data: () => structuredClone(v) });
          }
        }
        return { empty: d.length === 0, docs: d, size: d.length };
      },
      where: () => ({
        where: () => ({
          orderBy: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ docs: [], size: 0 })
              })
            })
          })
        })
      })
    }),
    runTransaction: async fn => {
      const writes = [];
      const result = await fn({
        get: async ref => snap(ref.key),
        set: (ref, data) => writes.push([ref.key, structuredClone(data)])
      });
      writes.forEach(([k, v]) => docs.set(k, v));
      return result;
    }
  };

  const auth = {
    verifyIdToken: async token => {
      if (token === 'bad') throw Error();
      return {
        uid: token,
        firebase: { sign_in_provider: token === 'admin' ? 'password' : 'anonymous' }
      };
    }
  };

  const env = { OPERATIONS_ENABLED: 'true', ADMIN_UIDS: 'admin' };

  const request = async (path, method = 'GET', body, uid = 'owner') => {
    const response = await route(
      new Request('https://test.local/api' + path, {
        method,
        headers: { authorization: 'Bearer ' + uid },
        body: body ? JSON.stringify(body) : undefined
      }),
      { db, auth },
      env
    );
    return response.json();
  };

  return { docs, request, env };
}

test('API: ownership, retry safety, immutable signed record, server evidence', async () => {
  const { request, docs } = fixture(), id = randomUUID(), body = { id, operatorId: 'persona-1', truckId: 'camion-1' };
  await request('/consultations', 'POST', body);
  await request('/consultations', 'POST', body);
  assert.equal([...docs.keys()].filter(k => k.startsWith('consultations/')).length, 1);

  await assert.rejects(() => request('/consultations/' + id, 'GET', null, 'other'));
  await assert.rejects(() => request('/consultations', 'POST', body, 'other'));

  const event = { eventId: randomUUID(), kind: 'answer', question: 'area', answer: 'dry' };
  await request('/consultations/' + id, 'PATCH', event);
  await request('/consultations/' + id, 'PATCH', event);

  await assert.rejects(() => request('/consultations/' + id, 'PATCH', { ...event, answer: 'wet' }));

  await request('/consultations/' + id, 'PATCH', { eventId: randomUUID(), kind: 'answer', question: 'epp', answer: 'yes' });

  const signed = {
    eventId: randomUUID(),
    kind: 'sign',
    name: 'CMZ Responsable',
    identifier: '123456',
    material: 'Polvo mineral',
    pickup: 'Sector A',
    accepted: true,
    declaration: DECLARATION,
    version: VERSION,
    signature: [Array.from({ length: 12 }, (_, i) => [.1 + i * .03, .2 + (i % 2) * .06])]
  };

  const r = await request('/consultations/' + id, 'PATCH', signed);
  assert.equal(r.result.color, 'green');
  assert.match(r.evidence_hash, /^[a-f0-9]{64}$/);
  assert.equal(r.events.length, 3);
  assert.equal(r.owner_uid, undefined);

  assert.deepEqual(await request('/consultations/' + id, 'PATCH', signed), r);
  await assert.rejects(() => request('/consultations/' + id, 'PATCH', { ...signed, eventId: randomUUID() }));

  await assert.rejects(() => request('/admin/records'));
  assert.equal((await request('/consultations/' + id, 'GET', null, 'admin')).id, id);
});

test('API rejects anonymous admin, stale consultation and disabled operation', async () => {
  const { request, env, docs } = fixture();
  await assert.rejects(() => request('/catalog', 'GET', null, 'bad'));

  const id = randomUUID();
  await request('/consultations', 'POST', { id, operatorId: 'persona-1', truckId: 'camion-1' });
  docs.get('consultations/' + id).started_at = '2020-01-01T00:00:00Z';

  await assert.rejects(() => request('/consultations/' + id, 'PATCH', { eventId: randomUUID(), kind: 'answer', question: 'area', answer: 'dry' }));

  env.OPERATIONS_ENABLED = 'false';
  await assert.rejects(() => request('/consultations', 'POST', { id: randomUUID(), operatorId: 'persona-1', truckId: 'camion-1' }));
  assert.equal((await request('/catalog')).enabled, false);
});

test('API: Admin Catalog Management (Add, Toggle, Delete Operators & Trucks)', async () => {
  const { request } = fixture();
  
  // Non-admin rejected
  await assert.rejects(() => request('/admin/catalog', 'GET', null, 'owner'));

  // Admin gets initial catalog (seeded)
  const initial = await request('/admin/catalog', 'GET', null, 'admin');
  assert.ok(initial.people.length >= 5);
  assert.ok(initial.trucks.length >= 5);

  // Add new operator
  const newOp = await request('/admin/people', 'POST', { name: 'Carlos Fuentes' }, 'admin');
  assert.equal(newOp.name, 'Carlos Fuentes');
  assert.equal(newOp.active, true);

  // Toggle operator inactive
  await request('/admin/people/' + newOp.id, 'PATCH', { active: false }, 'admin');
  const catalogAfterDeactivate = await request('/admin/catalog', 'GET', null, 'admin');
  const foundOp = catalogAfterDeactivate.people.find(p => p.id === newOp.id);
  assert.equal(foundOp.active, false);

  // Operator does not appear in public catalog when inactive
  const publicCatalog = await request('/catalog', 'GET', null, 'owner');
  assert.ok(!publicCatalog.people.some(p => p.id === newOp.id));

  // Add new truck
  const newTruck = await request('/admin/trucks', 'POST', { plate: 'BBCC33' }, 'admin');
  assert.equal(newTruck.plate, 'BBCC33');

  // Delete operator and truck
  await request('/admin/people/' + newOp.id, 'DELETE', null, 'admin');
  await request('/admin/trucks/' + newTruck.id, 'DELETE', null, 'admin');

  const finalCatalog = await request('/admin/catalog', 'GET', null, 'admin');
  assert.ok(!finalCatalog.people.some(p => p.id === newOp.id));
  assert.ok(!finalCatalog.trucks.some(t => t.id === newTruck.id));
});
