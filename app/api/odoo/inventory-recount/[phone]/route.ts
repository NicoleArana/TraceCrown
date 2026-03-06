import { NextRequest, NextResponse } from 'next/server';
import { getInventoryRecountByPhone } from './get-user-by-phone';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  try {
    const { phone } = await params;
    const result = await getInventoryRecountByPhone(phone);

    if (!result.success) {
      return NextResponse.json(result, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Odoo inventory recount lookup error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
