import { connectOdoo } from "@/src/odoo/client";
import { NextRequest, NextResponse } from "next/server"


export async function GET(req: NextRequest) {
  const product = req.nextUrl.searchParams.get("product")
  const odoo = await connectOdoo();

  if (!product) {
    return NextResponse.json({ error: "Product parameter is required" }, { status: 400 })
  }

  const values = await odoo.searchRead(
    "stock.quant",
    [["product_id.name", "=", product]],
    ["product_id", "quantity", "location_id", "inventory_date"],
    {}
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stockInfo = values.map((item: any) => ({
    product: item.product_id?.[1],
    quantity: item.quantity,
    location: item.location_id?.[1],
    inventory_date: item.inventory_date
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalQuantity = stockInfo.reduce((sum: number, item: any) => sum + item.quantity, 0)

  return NextResponse.json({
    product,
    total_quantity: totalQuantity,
    details: stockInfo
  })
}