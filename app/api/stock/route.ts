import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {

  const product = req.nextUrl.searchParams.get("product")

  const response = await fetch("http://TU-ODOO:8069/jsonrpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          "odoo_db",
          2,
          "api_key_o_password",
          "product.product",
          "search_read",
          [[["name", "=", product]]],
          ["qty_available"]
        ]
      },
      id: 1
    })
  })

  const data = await response.json()

  return NextResponse.json(data)
}