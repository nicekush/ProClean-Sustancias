# PROClean MG · Control Operacional Super Sucker (Faena Zaldívar)

Sistema de consulta previa, validación de reglas de segregación química y captura de respaldo digital para operaciones de camión de alto vacío (Super Sucker) en Faena Zaldívar, Antofagasta Minerals.

---

## 📋 Propósito y Alcance

Este aplicativo permite registrar la evaluación de condiciones antes del inicio de la tarea de aspiración para prevenir incidentes por incompatibilidad química (especialmente presencia o sospecha de **OXILIX** y mezclas no identificadas), verificar el uso de EPP y registrar el respaldo formal del solicitante por CMZ mediante firma digital en pantalla.

> **Importante:** Esta herramienta es un control operacional administrativo de apoyo. No sustituye la autorización formal de trabajo, los permisos de trabajo seguro (PTS/AST), ni la inspección física obligatoria del camión y sus accesorios.

---

## 🏗️ Arquitectura Técnica

- **Frontend:** Single Page Application (SPA) ligera desarrollada con Vite + Vanilla JS/CSS3. Compatible con navegadores móviles en terreno.
- **Backend:** Netlify Functions (Node.js 22 ES Modules) con API REST (`/api/catalog`, `/api/consultations`, `/api/admin/records`).
- **Base de Datos y Autenticación:** Google Cloud Firestore + Firebase Authentication.
  - Operadores en terreno: Sesión en memoria mediante proveedor anónimo.
  - Administradores: Acceso mediante usuario y contraseña restringido por lista de UIDs autorizados.
- **Trazabilidad y No Repudio:** Cada registro firmado genera un hash criptográfico SHA-256 (`evidence_hash`) inmutable con los datos declarados y el vector de la firma digital.

---

## 🔒 Reglas Operacionales Críticas

1. **Detección de OXILIX:** Ante presencia declarada o sospecha de OXILIX, el sistema emite inmediatamente **TARJETA ROJA (NO INICIAR)** en el marco de la campaña *«Yo Digo No · Zaldívar»*.
2. **Área Seca:** Prohíbe aspiración de líquidos. Requiere confirmación de EPP y firma de respaldo de CMZ.
3. **Área Húmeda:** Exige identificación exclusiva de sustancias autorizadas (Agua, Ácido, Solución acidulada), verificación de tolva/mangueras limpias y aptas, EPP completo y firma de respaldo de CMZ.
4. **Respaldo de CMZ:** Captura nombre del solicitante, identificador/RUT, material específico, punto de aspiración, declaración de conformidad y firma táctil con validación de trazos.

---

## 🚀 Despliegue en Producción (Netlify + Firebase)

### 1. Variables de Entorno en Netlify
Configurar en **Netlify > Site configuration > Environment variables**:

| Variable | Descripción | Ejemplo / Formato |
| :--- | :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Credenciales de la cuenta de servicio de Firebase (JSON completo) | `{"type":"service_account",...}` |
| `ADMIN_UIDS` | UIDs de Firebase Auth autorizados para el panel administrativo | `uid1,uid2` |
| `OPERATIONS_ENABLED` | Interruptor operacional (`true` para habilitar consultas en terreno) | `true` |

### 2. Configuración en Firebase Console
1. **Authentication:**
   - Habilitar proveedor **Anónimo** (*Anonymous*).
   - Habilitar proveedor **Correo electrónico / Contraseña** (*Email/Password*).
   - Crear el usuario administrador y copiar su UID a la variable `ADMIN_UIDS`.
2. **Firestore Database:**
   - Desplegar las reglas de seguridad de `firestore.rules` (restringen todo acceso directo de cliente; el acceso se efectúa exclusivamente vía Netlify Functions autenticadas).

---

## 🧪 Pruebas Automatizadas

Para ejecutar la suite de pruebas unitarias y de integración:

```bash
npm test
```

Para compilar el frontend para producción:

```bash
npm run build
```
