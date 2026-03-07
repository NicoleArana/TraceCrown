import { connectOdoo } from "@/src/odoo/client";

export interface CompleteInventoryRecountResult {
  success: boolean;
  requestId: number;
  requestName: string | null;
  count: number;
  updatedQuantIds: number[];
  appliedAsUser: {
    id: number;
    name: string;
  };
  requestRemoved: boolean;
  message: string;
}

export async function completeInventoryRecount(
  requestIdInput: unknown,
  countInput: unknown
): Promise<CompleteInventoryRecountResult> {
  const requestId = Number(requestIdInput);
  const count = Number(countInput);

  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw new Error("requestId must be a positive integer");
  }

  if (!Number.isFinite(count) || count < 0) {
    throw new Error("count must be a number greater than or equal to 0");
  }

  const odoo = await connectOdoo();

  const result = (await odoo.execute_kw("stock.request.count", "trace_complete_recount_as_assignee", [
    [requestId, count],
  ])) as {
    success: boolean;
    request_id: number;
    request_name?: string;
    count: number;
    updated_quant_ids: number[];
    impersonated_user_id: number;
    impersonated_user_name: string;
    request_removed?: boolean;
  };

  return {
    success: result.success,
    requestId: result.request_id,
    requestName: result.request_name ?? null,
    count: result.count,
    updatedQuantIds: result.updated_quant_ids,
    appliedAsUser: {
      id: result.impersonated_user_id,
      name: result.impersonated_user_name,
    },
    requestRemoved: !!result.request_removed,
    message: "Inventory recount applied successfully",
  };
}
