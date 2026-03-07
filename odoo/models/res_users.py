from odoo import fields, models


class ResUsers(models.Model):
    _inherit = "res.users"

    trace_crown_role = fields.Selection(
        [("auditor", "Auditor"), ("director", "Director")],
        string="Trace Crown Role",
        help="Role used by Trace Crown integrations.",
    )
