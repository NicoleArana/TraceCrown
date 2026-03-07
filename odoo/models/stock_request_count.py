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

    def _get_assigned_user(self):
        self.ensure_one()
        assignment_field = self._get_assignment_field()
        if not assignment_field:
            return None
        return self[assignment_field]

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

    @api.model
    def trace_complete_recount_as_assignee(self, request_id, count=None):
        if count is None and isinstance(request_id, (list, tuple)) and len(request_id) >= 2:
            request_id, count = request_id[0], request_id[1]

        if isinstance(request_id, (list, tuple)):
            raise ValueError("request_id must be a scalar value")

        if count is None:
            raise ValueError("Count is required")

        try:
            request_id_int = int(request_id)
            count_float = float(count)
        except (TypeError, ValueError) as exc:
            raise ValueError("request_id and count must be numeric") from exc

        request = self.browse(request_id_int).exists()
        if not request:
            raise ValueError(f"Recount request {request_id_int} not found")

        assigned_user = request._get_assigned_user()
        if not assigned_user:
            raise ValueError(f"Recount request {request_id_int} has no assigned user")

        quant_ids = request.quant_ids.ids if "quant_ids" in request._fields else []
        if not quant_ids:
            raise ValueError(f"Recount request {request_id_int} has no quant_ids to update")

        quants = self.env["stock.quant"].browse(quant_ids).with_user(assigned_user)
        quants.write({"inventory_quantity": count_float})
        quants.action_apply_inventory()

        if "state" in request._fields:
            request.with_user(assigned_user).write({"state": "done"})

        return {
            "success": True,
            "request_id": request.id,
            "request_name": request.display_name,
            "count": count_float,
            "updated_quant_ids": quant_ids,
            "impersonated_user_id": assigned_user.id,
            "impersonated_user_name": assigned_user.name,
        }
