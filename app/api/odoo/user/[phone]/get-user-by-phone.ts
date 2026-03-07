import { connectOdoo } from '@/src/odoo/client';

type UserRole = 'auditor' | 'director';

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
    role: UserRole | null;
  } | null;
  error?: string;
}

export async function getUserByPhone(phone: string): Promise<UserByPhoneResponse> {
  const normalizedPhone = phone.replace(/\D/g, '');

  const normalizeRole = (value: unknown): UserRole | null => {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'auditor' || normalized === 'director') {
      return normalized;
    }

    return null;
  };

  const odoo = await connectOdoo();

  const partners = await odoo.searchRead(
    'res.partner',
    [],
    ['id', 'name', 'email', 'phone', 'mobile', 'user_ids', 'function'],
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
    function?: string;
    user_ids: number[];
  };

  let odooUser: { id: number; login: string; name: string; email: string; role: UserRole | null } | null = null;
  const userRoleFieldCandidates = ['trace_crown_role', 'x_studio_role', 'x_role', 'x_user_role'];

  if (partner.user_ids && partner.user_ids.length > 0) {
    const baseFields = ['id', 'login', 'name', 'email'];

    let selectedRoleField: string | null = null;
    let users: unknown[] = [];

    for (const roleField of userRoleFieldCandidates) {
      try {
        const fields = [...baseFields, roleField];
        users = await odoo.searchRead('res.users', [['id', '=', partner.user_ids[0]]], fields, {
          limit: 1,
        });
        selectedRoleField = roleField;
        break;
      } catch {
        continue;
      }
    }

    if (users.length === 0) {
      users = await odoo.searchRead('res.users', [['id', '=', partner.user_ids[0]]], baseFields, {
        limit: 1,
      });
    }

    if (users.length > 0) {
      const user = users[0] as {
        id: number;
        login: string;
        name: string;
        email: string;
        [key: string]: unknown;
      };

      const roleFromUserField = selectedRoleField ? normalizeRole(user[selectedRoleField]) : null;
      const roleFromPartnerFunction = normalizeRole(partner.function);

      odooUser = {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email,
        role: roleFromUserField ?? roleFromPartnerFunction,
      };
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
