import { NextRequest, NextResponse } from 'next/server';
import { connectOdoo } from '@/src/odoo/client';

interface CompleteRecountBody {
  requestId?: number;
  count?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompleteRecountBody;
    const requestId = Number(body.requestId);
    const count = Number(body.count);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json(
        { success: false, error: 'requestId must be a positive integer' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(count) || count < 0) {
      return NextResponse.json(
        { success: false, error: 'count must be a number greater than or equal to 0' },
        { status: 400 }
      );
    }

    const odoo = await connectOdoo();

    const result = (await odoo.execute_kw('stock.request.count', 'trace_complete_recount_as_assignee', [
      [requestId, count],
    ])) as {
      success: boolean;
      request_id: number;
      request_name?: string;
      count: number;
      updated_quant_ids: number[];
      impersonated_user_id: number;
      impersonated_user_name: string;
    };

    return NextResponse.json({
      success: result.success,
      requestId: result.request_id,
      requestName: result.request_name ?? null,
      count: result.count,
      updatedQuantIds: result.updated_quant_ids,
      appliedAsUser: {
        id: result.impersonated_user_id,
        name: result.impersonated_user_name,
      },
      message: 'Inventory recount applied successfully',
    });
  } catch (error) {
    console.error('Odoo inventory recount completion error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
