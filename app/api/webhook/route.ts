import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import {
  getOrCreateSession,
  isFirstMessage,
  markFirstMessageReceived,
  setSessionState,
} from "../../lib/session-manager";
import {
  getWelcomeMessage,
  getMainMenuButtons,
  getPlaceholderResponse,
  getErrorMessage,
  getUnauthorizedMessage,
  getAuditConfirmButtons,
  AUDIT_DETAILS_MESSAGE,
  COUNT_INPUT_MESSAGE,
  COUNT_CONFIRMATION_DETAILS_MESSAGE,
  getAuditConfirmationMessage,
  MENU_OPTIONS,
} from "../../lib/whatsapp-templates";
import { getUserByPhone } from "../odoo/user/[phone]/get-user-by-phone";

function createWhatsappClient() {
  return new WhatsAppClient({
    baseUrl: "https://api.kapso.ai/meta/whatsapp",
    kapsoApiKey: process.env.KAPSO_API_KEY!,
  });
}

export async function POST(req: Request) {
  let phoneNumber: string | undefined;
  
  try {
    const { event, data } = await req.json();

    console.log("Event:", event);
    console.log("Data:", JSON.stringify(data, null, 2));

    // Extract phone number from incoming message
    phoneNumber = data[0]?.message?.from;
    if (!phoneNumber) {
      console.error("No phone number found in webhook data");
      return new Response("OK", { status: 200 });
    }

    const client = createWhatsappClient();
    const phoneNumberId = process.env.PHONE_NUMBER_ID!;

    // Verify user exists in Odoo
    console.log("Verifying user in Odoo...");
    const userResponse = await getUserByPhone(phoneNumber);
    
    if (!userResponse.success || !userResponse.partner) {
      console.log(`User not found in Odoo for phone: ${phoneNumber}`);
      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: getUnauthorizedMessage(),
      });
      return new Response("OK", { status: 200 });
    }

    console.log(`User verified: ${userResponse.partner.name} (${userResponse.partner.email})`);

    // Get or create user session
    const session = await getOrCreateSession(phoneNumber);
    if (!session) {
      console.error("Failed to get or create session");
      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: getErrorMessage(),
      });
      return new Response("OK", { status: 200 });
    }

    console.log("Session state:", session.state);
    console.log("First message received:", session.first_message_received);

    // Check if this is a button interaction
    const buttonReply = data[0]?.message?.interactive?.button_reply;
    
    if (buttonReply) {
      // Handle button click
      const buttonId = buttonReply.id;
      console.log("Button clicked:", buttonId);

      const shouldSendPlaceholder =
        buttonId === MENU_OPTIONS.CREATE_PRODUCT ||
        buttonId === MENU_OPTIONS.CREATE_ORDER;

      if (shouldSendPlaceholder) {
        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: getPlaceholderResponse(buttonId),
        });
      }

      // Update session state based on button selection
      let newState: "creating_product" | "creating_order" | "auditing" | "menu" | "awaiting_audit_count" | "audit_count_confirm" = "menu";

      switch (buttonId) {
        case MENU_OPTIONS.CREATE_PRODUCT:
          newState = "creating_product";
          break;
        case MENU_OPTIONS.CREATE_ORDER:
          newState = "creating_order";
          break;
        case MENU_OPTIONS.START_AUDIT:
          // Send audit details
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: AUDIT_DETAILS_MESSAGE,
          });

          // Small delay to ensure messages arrive in order
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Send count input prompt
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: COUNT_INPUT_MESSAGE,
          });

          newState = "awaiting_audit_count";
          break;
        case MENU_OPTIONS.CONFIRM_AUDIT:
          // User confirmed the count - save and return to menu
          console.log("Audit confirmed, returning to menu");
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: COUNT_CONFIRMATION_DETAILS_MESSAGE,
          });

          await new Promise((resolve) => setTimeout(resolve, 500));

          await client.messages.sendInteractiveRaw({
            phoneNumberId,
            to: phoneNumber,
            interactive: getMainMenuButtons(),
          });

          await setSessionState(phoneNumber, "menu");
          return new Response("OK", { status: 200 });
        case MENU_OPTIONS.CORRECT_AUDIT:
          // User wants to correct the count - ask again
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: COUNT_INPUT_MESSAGE,
          });

          newState = "awaiting_audit_count";
          break;
      }

      await setSessionState(phoneNumber, newState);
      console.log(`Session state updated to: ${newState}`);

      return new Response("OK", { status: 200 });
    }

    // Handle text messages based on session state
    const textMessage = data[0]?.message?.text?.body;

    if (session.state === "awaiting_audit_count" && textMessage) {
      // User sent count in audit flow
      console.log("Received audit count:", textMessage);

      // Send confirmation with the count and buttons
      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: getAuditConfirmationMessage(textMessage),
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await client.messages.sendInteractiveRaw({
        phoneNumberId,
        to: phoneNumber,
        interactive: getAuditConfirmButtons(),
      });

      // Store the count in session data and update state
      await setSessionState(phoneNumber, "audit_count_confirm", {
        audit_count: textMessage,
      });

      console.log("Audit count confirmation sent");
      return new Response("OK", { status: 200 });
    }

    if (session.state === "audit_count_confirm") {
      // User sent text while in confirmation state - send menu
      console.log("User in audit_count_confirm state, sending menu");

      await client.messages.sendInteractiveRaw({
        phoneNumberId,
        to: phoneNumber,
        interactive: getMainMenuButtons(),
      });

      await setSessionState(phoneNumber, "menu");
      return new Response("OK", { status: 200 });
    }

    // Handle regular text messages
    if (!session.first_message_received) {
      // First message - send welcome and menu
      console.log("Sending welcome message to new user");

      // Send welcome message
      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: getWelcomeMessage(),
      });

      // Mark first message as received
      await markFirstMessageReceived(phoneNumber);

      // Small delay to ensure messages arrive in order
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send menu
      await client.messages.sendInteractiveRaw({
        phoneNumberId,
        to: phoneNumber,
        interactive: getMainMenuButtons(),
      });

      // Update state to menu
      await setSessionState(phoneNumber, "menu");

      console.log("Welcome message and menu sent");
    } else {
      // Returning user - send menu
      console.log("Sending menu to returning user");

      await client.messages.sendInteractiveRaw({
        phoneNumberId,
        to: phoneNumber,
        interactive: getMainMenuButtons(),
      });

      // Update state to menu
      await setSessionState(phoneNumber, "menu");

      console.log("Menu sent");
    }

    // Return 200 to acknowledge receipt
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error handling webhook:", error);

    // Try to send error message to user if we have their phone number
    if (phoneNumber) {
      try {
        const client = createWhatsappClient();
        await client.messages.sendText({
          phoneNumberId: process.env.PHONE_NUMBER_ID!,
          to: phoneNumber,
          body: getErrorMessage(),
        });
      } catch (sendError) {
        console.error("Error sending error message:", sendError);
      }
    }

    // Always return 200 to prevent webhook retries
    return new Response("OK", { status: 200 });
  }
}
