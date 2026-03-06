import Odoo from 'odoo-await';

const odoo = new Odoo({
  baseUrl: process.env.ODOO_URL || 'https://your-odoo-instance.com',
  db: process.env.ODOO_DB || 'your_database',
  username: process.env.ODOO_USERNAME || 'your_username',
  password: process.env.ODOO_PASSWORD || 'your_password',
});

export async function GET() {
  try {
    await odoo.connect(); //wait response to conection

    const users = await odoo.searchRead('res.users', [], ['id', 'login', 'name', 'email'], {
      limit: 10,
    }); //Json w/ the request (all the users in the db)

    return Response.json({ success: true, users }); //response
  } catch (error) {
    console.error('Odoo error:', error); //showing errors in the server
    return Response.json({ success: false, error: String(error) }, { status: 500 });
  }
}

