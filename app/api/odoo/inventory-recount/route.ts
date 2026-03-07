import { NextRequest, NextResponse } from 'next/server';
import { completeInventoryRecount } from './complete-recount';

interface CompleteRecountBody {
  requestId?: number;
  count?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompleteRecountBody;
    const result = await completeInventoryRecount(body.requestId, body.count);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === 'requestId must be a positive integer' ||
      message === 'count must be a number greater than or equal to 0'
    ) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    console.error('Odoo inventory recount completion error:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
