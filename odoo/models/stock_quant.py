from odoo import models
import requests
import threading


class StockQuant(models.Model):
    _inherit = "stock.quant"

    def write(self, vals):
        res = super(StockQuant, self).write(vals)
        if "quantity" in vals:
            for record in self:
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
