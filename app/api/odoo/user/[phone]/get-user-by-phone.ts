import { connectOdoo } from '@/src/odoo/client';

export interface UserByPhoneResponse {
  success: boolean;
  partner?: {
    id: number;
    name: string;
    email: string;
    phone: string;
    mobile: string;
  };
  user?: {
    id: number;
    login: string;
    name: string;
    email: string;
  } | null;
  error?: string;
}

export async function getUserByPhone(phone: string): Promise<UserByPhoneResponse> {
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
    phone: string;
    mobile: string;
    user_ids: number[];
  };

  let odooUser: { id: number; login: string; name: string; email: string } | null = null;
  if (partner.user_ids && partner.user_ids.length > 0) {
    const users = await odoo.searchRead(
      'res.users',
      [['id', '=', partner.user_ids[0]]],
      ['id', 'login', 'name', 'email'],
      { limit: 1 }
    );
    if (users.length > 0) {
      odooUser = users[0] as { id: number; login: string; name: string; email: string };
    }
  }

  return {
    success: true,
    partner: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      phone: partner.phone,
      mobile: partner.mobile,
    },
    user: odooUser,
  };
}
