import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Webhook received from Odoo:', body);
    return NextResponse.json({ success: true, received: body });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
