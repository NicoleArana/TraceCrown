from odoo import api, models
import requests
import threading


class StockRequestCount(models.TransientModel):
    _inherit = "stock.request.count"

    _ASSIGNEE_FIELDS = (
        "user_id",
        "assigned_user_id",
        "responsible_id",
        "requester_id",
        "requested_by",
    )

    def _get_assignment_field(self):
        for field_name in self._ASSIGNEE_FIELDS:
            if field_name in self._fields:
                return field_name
        return None

    def _build_assignment_payload(self, record, assignment_field):
        user = record[assignment_field]
        return {
            "event": "inventory.recount.assigned",
            "request_id": record.id,
            "request_name": record.display_name,
            "state": record.state if "state" in record._fields else None,
            "assigned_field": assignment_field,
            "assigned_user_id": user.id if user else None,
            "assigned_user_name": user.name if user else None,
        }

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        assignment_field = records._get_assignment_field()
        if not assignment_field:
            return records

        for record, vals in zip(records, vals_list):
            if vals.get(assignment_field) and record[assignment_field]:
                payload = record._build_assignment_payload(record, assignment_field)
                threading.Thread(target=record._send_webhook, args=(payload,), daemon=True).start()

        return records

    def write(self, vals):
        assignment_field = self._get_assignment_field()
        previous_assigned = {}

        if assignment_field and assignment_field in vals:
            for record in self:
                previous_assigned[record.id] = record[assignment_field].id if record[assignment_field] else None

        res = super().write(vals)

        if assignment_field and assignment_field in vals:
            for record in self:
                current_user = record[assignment_field]
                previous_user_id = previous_assigned.get(record.id)
                if current_user and current_user.id != previous_user_id:
                    payload = record._build_assignment_payload(record, assignment_field)
                    threading.Thread(target=record._send_webhook, args=(payload,), daemon=True).start()

        return res

    def _send_webhook(self, payload):
        try:
            requests.post("http://nextjs:3000/api/odoo", json=payload, timeout=5)
        except Exception:
            pass
