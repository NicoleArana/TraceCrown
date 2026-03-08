import { connectOdoo } from '@/src/odoo/client';

export interface RecountProduct {
  id: number;
  product_id: [number, string];
  quantity: number;
  location_id: [number, string];
  inventory_date?: string;
  lot_id?: [number, string];
  package_id?: [number, string];
}

export interface RecountRequestWithProducts {
  id: number;
  name?: string;
  display_name?: string;
  state?: string;
  inventory_date?: string;
  set_count?: string;
  products: RecountProduct[];
}

export interface InventoryRecountResponse {
  success: boolean;
  recountRequests: RecountRequestWithProducts[];
  user?: {
    id: number;
    name: string;
    email: string;
  } | null;
  phone?: string;
  error?: string;
}

export async function getInventoryRecountByPhone(
  phone: string
): Promise<InventoryRecountResponse> {
  const normalizedPhone = phone.replace(/\D/g, '');

  const odoo = await connectOdoo();

  const partners = await odoo.searchRead(
    'res.partner',
    [],
    ['id', 'name', 'email', 'phone', 'mobile', 'user_ids'],
    { limit: 100 }
  );

  const matched = partners.find((p: unknown) => {
    const partner = p as { phone?: string; mobile?: string };
    const phoneDigits = (partner.phone || '').replace(/\D/g, '');
    const mobileDigits = (partner.mobile || '').replace(/\D/g, '');
    return phoneDigits.includes(normalizedPhone) || mobileDigits.includes(normalizedPhone);
  });

  if (!matched) {
    return { success: false, error: 'Partner not found', recountRequests: [] };
  }

  const partner = matched as {
    id: number;
    name: string;
    email: string;
    user_ids: number[];
  };

  let odooUser: { id: number; name: string; email: string } | null = null;
  if (partner.user_ids && partner.user_ids.length > 0) {
    const users = await odoo.searchRead(
      'res.users',
      [['id', '=', partner.user_ids[0]]],
      ['id', 'name', 'email'],
      { limit: 1 }
    );
    if (users.length > 0) {
      odooUser = users[0] as { id: number; name: string; email: string };
    }
  }

  if (!odooUser) {
    return {
      success: true,
      recountRequests: [],
      user: null,
    };
  }

  const recountFieldSets: Array<string[] | undefined> = [
    [
      'id',
      'name',
      'display_name',
      'state',
      'inventory_date',
      'quant_ids',
      'set_count',
      'user_id',
      'assigned_user_id',
      'responsible_id',
      'requester_id',
      'requested_by',
      'create_uid',
      'create_date',
      'write_uid',
      'write_date',
    ],
    ['id', 'name', 'display_name', 'state', 'quant_ids', 'user_id'],
    undefined,
  ];

  let inventoryRecounts: unknown[] = [];
  for (const fields of recountFieldSets) {
    try {
      inventoryRecounts = await odoo.searchRead('stock.request.count', [], fields, {
        limit: 100,
      });
      break;
    } catch {
      continue;
    }
  }

  const userFieldCandidates = [
    'user_id',
    'assigned_user_id',
    'responsible_id',
    'requester_id',
    'requested_by',
  ];

  const getRelatedId = (value: unknown): number | null => {
    if (typeof value === 'number') {
      return value;
    }

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
      return value[0];
    }

    return null;
  };

  const assignedRequests = (inventoryRecounts as Array<Record<string, unknown>>).filter((request) => {
    return userFieldCandidates.some((field) => getRelatedId(request[field]) === odooUser.id);
  });

  const openAssignedRequests = assignedRequests.filter((request) => {
    const state = typeof request.state === 'string' ? request.state.toLowerCase() : '';
    return state !== 'done' && state !== 'cancel' && state !== 'cancelled';
  });

  const recountRequestsWithProducts: RecountRequestWithProducts[] = await Promise.all(
    openAssignedRequests.map(async (request) => {
      const req = request as Record<string, unknown>;
      const quantIds = req.quant_ids;

      let products: RecountProduct[] = [];

      if (Array.isArray(quantIds) && quantIds.length > 0) {
        const quantIdNumbers = quantIds.filter((id): id is number => typeof id === 'number');

        if (quantIdNumbers.length > 0) {
          const quants = (await odoo.searchRead(
            'stock.quant',
            [['id', 'in', quantIdNumbers]],
            ['id', 'product_id', 'quantity', 'location_id', 'inventory_date', 'lot_id', 'package_id'],
            { limit: 100 }
          )) as Array<Record<string, unknown>>;

          products = quants.map((q) => ({
            id: q.id as number,
            product_id: q.product_id as [number, string],
            quantity: q.quantity as number,
            location_id: q.location_id as [number, string],
            inventory_date: q.inventory_date as string | undefined,
            lot_id: q.lot_id as [number, string] | undefined,
            package_id: q.package_id as [number, string] | undefined,
          }));
        }
      }

      return {
        id: req.id as number,
        name: req.name as string | undefined,
        display_name: req.display_name as string | undefined,
        state: req.state as string | undefined,
        inventory_date: req.inventory_date as string | undefined,
        set_count: req.set_count as string | undefined,
        products,
      };
    })
  );

  return {
    success: true,
    recountRequests: recountRequestsWithProducts,
    user: odooUser,
  };
}
