import { connectOdoo } from "@/src/odoo/client";

// Session data structure from Odoo
export interface WhatsAppSession {
  id: number;
  phone_number: string;
  state: "new" | "menu" | "creating_product" | "creating_order" | "auditing" | "awaiting_audit_count" | "audit_count_confirm";
  session_data: Record<string, unknown>;
  first_message_received: boolean;
  last_interaction: string;
}

/**
 * Get or create a WhatsApp session for a phone number using Odoo's model method
 * 
 * @param phoneNumber - User's WhatsApp phone number
 * @returns WhatsApp session record
 */
async function getUserSession(phoneNumber: string): Promise<WhatsAppSession | null> {
  try {
    const odoo = await connectOdoo();

    // Call Odoo method to get or create session
    const sessionId = await odoo.execute_kw(
      "whatsapp.session",
      "get_or_create_session",
      [[phoneNumber]]
    );

    // Read the session data
    const sessions = await odoo.read("whatsapp.session", sessionId, [
      "id",
      "phone_number",
      "state",
      "session_data",
      "first_message_received",
      "last_interaction",
    ]);

    return (sessions?.[0] as WhatsAppSession | undefined) || null;
  } catch (error) {
    console.error("Error getting user session from Odoo:", error);
    throw error;
  }
}

/**
 * Update a WhatsApp session in Odoo
 * 
 * @param phoneNumber - User's WhatsApp phone number
 * @param updates - Fields to update
 */
async function updateUserSession(
  phoneNumber: string,
  updates: Partial<Omit<WhatsAppSession, "id" | "phone_number">>
): Promise<void> {
  try {
    const odoo = await connectOdoo();

    const sessionId = await odoo.execute_kw(
      "whatsapp.session",
      "get_or_create_session",
      [[phoneNumber]]
    );

    // Update the session
    await odoo.update("whatsapp.session", sessionId, updates);
  } catch (error) {
    console.error("Error updating user session in Odoo:", error);
    throw error;
  }
}

/**
 * Reset a WhatsApp session to menu state
 * 
 * @param phoneNumber - User's WhatsApp phone number
 */
async function resetUserSession(phoneNumber: string): Promise<void> {
  try {
    const odoo = await connectOdoo();

    const sessionId = await odoo.execute_kw(
      "whatsapp.session",
      "get_or_create_session",
      [[phoneNumber]]
    );

    // Call the reset_session method
    await odoo.execute_kw("whatsapp.session", "reset_session", [[sessionId]]);
  } catch (error) {
    console.error("Error resetting user session in Odoo:", error);
    throw error;
  }
}

/**
 * Get or create a session for a user
 * 
 * @param phoneNumber - User's WhatsApp phone number
 * @returns WhatsApp session
 */
export async function getOrCreateSession(
  phoneNumber: string
): Promise<WhatsAppSession | null> {
  try {
    return await getUserSession(phoneNumber);
  } catch (error) {
    console.error("Error in getOrCreateSession:", error);
    throw error;
  }
}

/**
 * Check if this is the user's first message
 * 
 * @param phoneNumber - User's WhatsApp phone number
 * @returns True if first message, false otherwise
 */
export async function isFirstMessage(
  phoneNumber: string
): Promise<boolean> {
  try {
    const session = await getUserSession(phoneNumber);
    return session ? !session.first_message_received : true;
  } catch (error) {
    console.error("Error checking first message:", error);
    return true; // Default to first message on error
  }
}

/**
 * Get the current session state for a user
 * 
 * @param phoneNumber - User's WhatsApp phone number
 * @returns Current session state
 */
export async function getSessionState(
  phoneNumber: string
): Promise<WhatsAppSession["state"] | null> {
  try {
    const session = await getUserSession(phoneNumber);
    return session?.state || null;
  } catch (error) {
    console.error("Error getting session state:", error);
    return null;
  }
}

/**
 * Update the session state for a user
 * 
 * @param phoneNumber - User's WhatsApp phone number
 * @param state - New state
 * @param sessionData - Optional session data to update
 */
export async function setSessionState(
  phoneNumber: string,
  state: WhatsAppSession["state"],
  sessionData?: Record<string, unknown>
): Promise<void> {
  try {
    const updates: Partial<Omit<WhatsAppSession, "id" | "phone_number">> = {
      state,
    };

    if (sessionData !== undefined) {
      updates.session_data = sessionData;
    }

    await updateUserSession(phoneNumber, updates);
  } catch (error) {
    console.error("Error setting session state:", error);
    throw error;
  }
}

/**
 * Mark the first message as received for a user
 * 
 * @param phoneNumber - User's WhatsApp phone number
 */
export async function markFirstMessageReceived(
  phoneNumber: string
): Promise<void> {
  try {
    await updateUserSession(phoneNumber, {
      first_message_received: true,
    });
  } catch (error) {
    console.error("Error marking first message received:", error);
    throw error;
  }
}

/**
 * Reset a user's session to the main menu
 * 
 * @param phoneNumber - User's WhatsApp phone number
 */
export async function resetToMenu(phoneNumber: string): Promise<void> {
  try {
    await resetUserSession(phoneNumber);
  } catch (error) {
    console.error("Error resetting to menu:", error);
    throw error;
  }
}
