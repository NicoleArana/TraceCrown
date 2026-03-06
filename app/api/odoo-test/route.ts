import Odoo from 'odoo-await';

const odoo = new Odoo({
  baseUrl: process.env.ODOO_URL || 'https://your-odoo-instance.com',
  db: process.env.ODOO_DB || 'your_database',
  username: process.env.ODOO_USERNAME || 'your_username',
  password: process.env.ODOO_PASSWORD || 'your_password',
});

export async function GET() {
  try {
    await odoo.connect();

    const users = await odoo.searchRead('res.partner', undefined, ['id', 'name', 'email', 'phone', 'mobile', 'user_ids'], {
      limit: 10,
    });

    return Response.json({ success: true, users });
  } catch (error) {
    console.error('Odoo error:', error);
    return Response.json({ success: false, error: String(error) }, { status: 500 });
  }
}
