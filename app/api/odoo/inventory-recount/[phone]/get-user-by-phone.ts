import { connectOdoo } from '@/src/odoo/client';

export interface InventoryRecountResponse {
  success: boolean;
  hasRecountRequest?: boolean;
  recountRequest?: {
    id: number;
    name?: string;
    display_name?: string;
    state?: string;
    [key: string]: unknown;
  } | null;
  recountRequests?: Array<{
    id: number;
    name?: string;
    display_name?: string;
    state?: string;
    [key: string]: unknown;
  }>;
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
    return { success: false, error: 'Partner not found' };
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
      hasRecountRequest: false,
      recountRequest: null,
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

  const activeRecount = openAssignedRequests.find((request) => {
    const state = typeof request.state === 'string' ? request.state.toLowerCase() : '';
    return state !== 'done' && state !== 'cancel' && state !== 'cancelled';
  }) || openAssignedRequests[0];

  return {
    success: true,
    hasRecountRequest: !!activeRecount,
    recountRequest: activeRecount
      ? (activeRecount as {
          id: number;
          name?: string;
          display_name?: string;
          state?: string;
          [key: string]: unknown;
        })
      : null,
    recountRequests: openAssignedRequests as Array<{
      id: number;
      name?: string;
      display_name?: string;
      state?: string;
      [key: string]: unknown;
    }>,
    user: odooUser,
  };
}
