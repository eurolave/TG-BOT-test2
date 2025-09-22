import { searchByVIN, partsByAssembly, partByOEM, crossesByOEM } from '../clients/laximo.js';

export async function runAction(actionName, ctx, session) {
  switch (actionName) {
    case 'getAssembliesByVIN': {
      const vin = session.data.vin;
      return await searchByVIN(vin); // { vehicle, assemblies }
    }
    case 'getPartsByAssembly': {
      const asmId = (session.lastCallback || '').split(':')[1];
      if (!asmId) throw new Error('assemblyId not found');
      return await partsByAssembly(asmId);   // { items }
    }
    case 'getPartByOEM': {
      const oem = session.data.oem;
      return await partByOEM(oem);
    }
    case 'getCrossesByOEM': {
      const last = session.lastCallback || '';
      const oem = last.startsWith('x:') ? last.slice(2) : (session.data.oem || '');
      if (!oem) throw new Error('OEM is empty');
      return await crossesByOEM(oem);
    }
    case 'addToCart': {
      const last = session.lastCallback || '';
      const oem = last.startsWith('cart:') ? last.slice(5) : (session.data.oem || '');
      session.data.cart = [...(session.data.cart || []), { oem, qty: 1 }];
      return { ok: true, oem };
    }
    default:
      throw new Error('Unknown action: ' + actionName);
  }
}
