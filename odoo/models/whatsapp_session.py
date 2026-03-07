from odoo import models, fields, api


class WhatsAppSession(models.Model):
    _name = "whatsapp.session"
    _description = "WhatsApp Bot Session Management"
    _order = "last_interaction desc"

    phone_number = fields.Char(
        string="Phone Number",
        required=True,
        index=True,
        help="User's WhatsApp phone number",
    )
    state = fields.Selection(
        [
            ("new", "New"),
            ("menu", "Main Menu"),
            ("creating_product", "Creating Product"),
            ("creating_order", "Creating Order"),
            ("auditing", "Auditing"),
            ("awaiting_audit_count", "Awaiting Audit Count"),
            ("audit_count_confirm", "Audit Count Confirmation"),
        ],
        string="Session State",
        default="new",
        required=True,
        help="Current state in the conversation flow",
    )
    session_data = fields.Json(
        string="Session Data", help="Temporary data for multi-step flows (JSON format)"
    )
    first_message_received = fields.Boolean(
        string="First Message Received",
        default=False,
        help="Flag to track if welcome message was already sent",
    )
    last_interaction = fields.Datetime(
        string="Last Interaction",
        default=fields.Datetime.now,
        help="Timestamp of last message received",
    )

    _sql_constraints = [
        ("phone_number_unique", "UNIQUE(phone_number)", "Phone number must be unique!")
    ]

    @api.model
    def get_or_create_session(self, phone_number):
        """
        Get existing session or create a new one for the given phone number.

        :param phone_number: WhatsApp phone number
        :return: session ID (int)
        """
        session = self.search([("phone_number", "=", phone_number)], limit=1)
        if not session:
            session = self.create(
                {
                    "phone_number": phone_number,
                    "state": "new",
                    "first_message_received": False,
                    "session_data": {},
                }
            )
        else:
            # Update last interaction timestamp
            session.write({"last_interaction": fields.Datetime.now()})
        return session.id

    def reset_session(self):
        """Reset session to menu state and clear session data."""
        self.ensure_one()
        self.write(
            {
                "state": "menu",
                "session_data": {},
            }
        )

    def update_session_data(self, data):
        """
        Update session data with new values.

        :param data: Dictionary of data to merge with existing session_data
        """
        self.ensure_one()
        current_data = self.session_data or {}
        current_data.update(data)
        self.write(
            {
                "session_data": current_data,
                "last_interaction": fields.Datetime.now(),
            }
        )
