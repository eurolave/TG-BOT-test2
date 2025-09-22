// src/clients/laximo.js
import axios from 'axios';

const RAW_BASE = process.env.LAXIMO_BASE_URL || '';
if (!RAW_BASE) console.warn('[LAXIMO] LAXIMO_BASE_URL is not set');
const BASE = RAW_BASE.replace(/\/$/, '');

const PATH_FINDVEHICLE    = process.env.LAXIMO_PATH_FINDVEHICLE    || '/cat/findVehicle';
const PATH_LIST_UNITS     = process.env.LAXIMO_PATH_LIST_UNITS     || '/cat/listUnits';
const PATH_LIST_PARTS     = process.env.LAXIMO_PATH_LIST_PARTS     || '/cat/listDetailByUnit';
const PATH_PART_BY_OEM    = process.env.LAXIMO_PATH_PART_BY_OEM    || '/doc/partByOem';
const PATH_CROSSES_BY_OEM = process.env.LAXIMO_PATH_CROSSES_BY_OEM || '/doc/crosses';

const DEF_CATEGORY = process.env.LAXIMO_DEFAULT_CATEGORY ?? '0';
const DEF_GROUP    = process.env.LAXIMO_DEFAULT_GROUP ?? '1';

function u(path) { return BASE + path; }

async function getJSON(url, params) {
  try {
    const { data } = await axios.get(url, { params, timeout: 12000 });
    return data;
  } catch (e) {
    console.error('[LAXIMO_HTTP_ERROR]', url, 'params=', params, 'status=', e.response?.status, 'data=', e.response?.data, 'msg=', e.message);
    throw e;
  }
}

// Нормализация
function normVehicle(v) {
  if (!v || typeof v !== 'object') return { vehicleid: '', catalog: '', ssd: '', brand: '', name: '' };
  return {
    vehicleid: String(v.vehicleid ?? ''),
    catalog: String(v.catalog ?? ''),
    ssd: String(v.ssd ?? ''),
    brand: String(v.brand ?? ''),
    name: String(v.name ?? '')
  };
}
function normUnits(raw) {
  const arr = Array.isArray(raw?.assemblies) ? raw.assemblies : (Array.isArray(raw) ? raw : []);
  return arr.map(r => ({ id: String(r.id ?? r.unitid ?? r.code ?? ''), name: String(r.name ?? '') })).filter(r => r.id);
}
function normParts(raw) {
  const arr = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);
  return arr.map(p => ({ oem: String(p.oem ?? p.code ?? p.partnumber ?? ''), brand: String(p.brand ?? p.maker ?? ''), name: String(p.name ?? p.title ?? '') })).filter(p => p.oem);
}
function normCrosses(raw) {
  const arr = Array.isArray(raw?.crosses) ? raw.crosses : (Array.isArray(raw) ? raw : []);
  return arr.map(c => ({ oem: String(c.oem ?? c.code ?? ''), brand: String(c.brand ?? c.maker ?? ''), name: String(c.name ?? c.title ?? '') })).filter(c => c.oem);
}

let lastVinCtx = { catalog: '', ssd: '' };

export async function searchByVIN(vin) {
  const fv = await getJSON(u(PATH_FINDVEHICLE), { vin });
  const vehicle = normVehicle(fv);
  if (!vehicle.catalog || !vehicle.ssd) {
    console.warn('[LAXIMO] findVehicle returned no catalog/ssd:', fv);
    return { vehicle, assemblies: [] };
  }
  lastVinCtx = { catalog: vehicle.catalog, ssd: vehicle.ssd };

  const units = await getJSON(u(PATH_LIST_UNITS), { catalog: vehicle.catalog, ssd: vehicle.ssd, category: DEF_CATEGORY, group: DEF_GROUP });
  const assemblies = normUnits(units);
  return { vehicle, assemblies };
}

export async function partsByAssembly(assemblyId) {
  if (!lastVinCtx.catalog || !lastVinCtx.ssd) throw new Error('VIN context missing — call searchByVIN() first');
  const data = await getJSON(u(PATH_LIST_PARTS), { catalog: lastVinCtx.catalog, ssd: lastVinCtx.ssd, unitid: assemblyId });
  const items = normParts(data);
  return { items };
}

export async function partByOEM(oem) {
  const raw = await getJSON(u(PATH_PART_BY_OEM), { oem });
  const p = Array.isArray(raw) ? raw[0] : raw;
  if (!p) return null;
  return { oem: String(p.oem ?? p.code ?? oem), brand: String(p.brand ?? p.maker ?? ''), name: String(p.name ?? p.title ?? '') };
}
export async function crossesByOEM(oem) {
  const raw = await getJSON(u(PATH_CROSSES_BY_OEM), { oem });
  return { crosses: normCrosses(raw) };
}
