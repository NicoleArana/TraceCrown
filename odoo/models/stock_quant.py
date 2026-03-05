from odoo import models
import requests
import threading


class StockQuant(models.Model):
    _inherit = "stock.quant"

    def write(self, vals):
        res = super().write(vals)

        if "quantity" not in vals:
            return res

        def send_webhook(url, data):
            try:
                requests.post(url, json=data, timeout=5)
            except Exception:
                pass

        webhook_url = "http://nextjs:3000/api/odoo"
        payload = {
            "event": "inventory.changed",
            "product": self.product_id.name,
            "quantity": self.quantity,
            "secret": "your_shared_secret",
        }

        threading.Thread(target=send_webhook, args=(webhook_url, payload)).start()

        return res
