from odoo import models, fields
import requests
import threading


class StockMove(models.Model):
    _inherit = "stock.move"

    whatsapp_audit_source = fields.Boolean(default=False)
    inventory_recorded = fields.Float()
    inventory_expected = fields.Float()

    def write(self, vals):
        res = super(StockMove, self).write(vals)
        if "state" in vals and vals["state"] == "done":
            for record in self:
                if record.location_id.usage == "internal":
                    payload = {
                        "event": "inventory.updated_by_user",
                        "product": record.product_id.name,
                        "new_quantity": record.quantity,
                        "location": record.location_id.display_name,
                    }
                    threading.Thread(target=self._send_webhook, args=(payload,)).start()
        return res

    def _send_webhook(self, payload):
        try:
            requests.post("http://nextjs:3000/api/odoo", json=payload, timeout=5)
        except Exception:
            pass
