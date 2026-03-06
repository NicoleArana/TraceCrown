import Odoo from 'odoo-await';

let odooInstance: Odoo | null = null;

export function getOdooClient(): Odoo {
  if (!odooInstance) {
    odooInstance = new Odoo({
      baseUrl: process.env.ODOO_URL || 'https://your-odoo-instance.com',
      db: process.env.ODOO_DB || 'your_database',
      username: process.env.ODOO_USERNAME || 'your_username',
      password: process.env.ODOO_PASSWORD || 'your_password',
    });
  }
  return odooInstance;
}

export async function connectOdoo(): Promise<Odoo> {
  const client = getOdooClient();
  await client.connect();
  return client;
}
