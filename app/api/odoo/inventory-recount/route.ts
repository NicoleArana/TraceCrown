import { NextRequest, NextResponse } from 'next/server';
import { connectOdoo } from '@/src/odoo/client';

interface CompleteRecountBody {
  requestId?: number;
  count?: number;
}

const parseQuantIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((id): id is number => typeof id === 'number');
};

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

    const recounts = await odoo.searchRead(
      'stock.request.count',
      [['id', '=', requestId]],
      ['id', 'display_name', 'quant_ids'],
      { limit: 1 }
    );

    if (recounts.length === 0) {
      return NextResponse.json(
        { success: false, error: `Recount request ${requestId} not found` },
        { status: 404 }
      );
    }

    const recount = recounts[0] as {
      id: number;
      display_name?: string;
      quant_ids?: unknown;
    };

    const quantIds = parseQuantIds(recount.quant_ids);
    if (quantIds.length === 0) {
      return NextResponse.json(
        { success: false, error: `Recount request ${requestId} has no quant_ids to update` },
        { status: 400 }
      );
    }

    for (const quantId of quantIds) {
      await odoo.update('stock.quant', quantId, { inventory_quantity: count });
    }

    await odoo.execute_kw('stock.quant', 'trace_apply_inventory_with_history', [quantIds]);

    try {
      await odoo.update('stock.request.count', requestId, { state: 'done' });
    } catch {
      // Optional: some implementations do not expose state on this model.
    }

    return NextResponse.json({
      success: true,
      requestId,
      requestName: recount.display_name ?? null,
      count,
      updatedQuantIds: quantIds,
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
