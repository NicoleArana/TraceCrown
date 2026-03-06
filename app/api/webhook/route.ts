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
  MENU_OPTIONS,
} from "../../lib/whatsapp-templates";

function createWhatsappClient() {
  return new WhatsAppClient({
    baseUrl: "https://api.kapso.ai/meta/whatsapp",
    kapsoApiKey: process.env.KAPSO_API_KEY!,
  });
}

export async function POST(req: Request) {
  try {
    const { event, data } = await req.json();

    console.log("Event:", event);
    console.log("Data:", JSON.stringify(data, null, 2));

    // Extract phone number from incoming message
    const phoneNumber = data[0]?.message?.from;
    if (!phoneNumber) {
      console.error("No phone number found in webhook data");
      return new Response("OK", { status: 200 });
    }

    const client = createWhatsappClient();
    const phoneNumberId = process.env.PHONE_NUMBER_ID!;

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

      // Send placeholder response
      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: getPlaceholderResponse(buttonId),
      });

      // Update session state based on button selection
      let newState: "creating_product" | "creating_order" | "auditing" | "menu" = "menu";
      
      switch (buttonId) {
        case MENU_OPTIONS.CREATE_PRODUCT:
          newState = "creating_product";
          break;
        case MENU_OPTIONS.CREATE_ORDER:
          newState = "creating_order";
          break;
        case MENU_OPTIONS.START_AUDIT:
          newState = "auditing";
          break;
      }

      await setSessionState(phoneNumber, newState);
      console.log(`Session state updated to: ${newState}`);

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
    try {
      const { data } = await req.json();
      const phoneNumber = data[0]?.message?.from;
      
      if (phoneNumber) {
        const client = createWhatsappClient();
        await client.messages.sendText({
          phoneNumberId: process.env.PHONE_NUMBER_ID!,
          to: phoneNumber,
          body: getErrorMessage(),
        });
      }
    } catch (sendError) {
      console.error("Error sending error message:", sendError);
    }

    // Always return 200 to prevent webhook retries
    return new Response("OK", { status: 200 });
  }
}
