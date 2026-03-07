import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import {
  getOrCreateSession,
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
  COUNT_INPUT_MESSAGE,
  getAuditConfirmationMessage,
  MENU_OPTIONS,
  getCountConfirmationDetails,
} from "../../lib/whatsapp-templates";
import { getUserByPhone } from "../odoo/user/[phone]/get-user-by-phone";
import { getInventoryRecountByPhone } from "../odoo/inventory-recount/[phone]/get-user-by-phone";
import { completeInventoryRecount } from "../odoo/inventory-recount/complete-recount";

type RecountRequestOption = {
  id: number;
  name?: string;
  display_name?: string;
  state?: string;
  product_name?: string;
  location_name?: string;
  expected_qty?: number;
  [key: string]: unknown;
};

const RECOUNT_SELECTION_ROW_PREFIX = "select_recount_";
const RECOUNT_SELECTION_BACK_ID = "recount_back_to_menu";

function toListRowTitle(request: RecountRequestOption): string {
  const maxLength = 24;
  const rawTitle = getRequestDisplayName(request);
  return rawTitle.length <= maxLength
    ? rawTitle
    : `${rawTitle.slice(0, maxLength - 1)}…`;
}

function toListRowDescription(request: RecountRequestOption): string {
  const product = getRequestProduct(request);
  const location = getRequestLocation(request);
  return `${product} | ${location}`;
}

function getMany2oneName(value: unknown): string | null {
  if (Array.isArray(value) && value.length > 1 && typeof value[1] === "string") {
    return value[1];
  }
  return null;
}

function getRequestDisplayName(request: RecountRequestOption): string {
  return `Solicitud #${request.id}`;
}

function getRequestProduct(request: RecountRequestOption): string {
  const fromMany2one = getMany2oneName(request.product_id);
  return request.product_name || fromMany2one || "No especificado";
}

function getRequestLocation(request: RecountRequestOption): string {
  const fromMany2one = getMany2oneName(request.location_id);
  return request.location_name || fromMany2one || "No especificada";
}

function getRequestExpectedCount(request: RecountRequestOption): string {
  const expectedQty = request.expected_qty;
  if (typeof expectedQty === "number") {
    return String(expectedQty);
  }

  const inventoryQty = request.inventory_qty;
  if (typeof inventoryQty === "number") {
    return String(inventoryQty);
  }

  const productQty = request.product_qty;
  if (typeof productQty === "number") {
    return String(productQty);
  }

  return "N/A";
}

function buildAuditDetailsMessage(request: RecountRequestOption): string {
  return (
    "📋 *Detalles de Auditoría*\n\n" +
    `🧾 *Solicitud:* ${getRequestDisplayName(request)}\n` +
    `📍 *Ubicación:* ${getRequestLocation(request)}\n` +
    `📦 *Producto:* ${getRequestProduct(request)}`
  );
}

function getSelectionOptions(sessionData: Record<string, unknown>): RecountRequestOption[] {
  const raw = sessionData.recount_request_options;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is RecountRequestOption =>
      typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "number"
  );
}

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

    // Check if this is an interactive reply
    const interactiveReply = data[0]?.message?.interactive;
    const buttonReply = interactiveReply?.button_reply;
    const listReply = interactiveReply?.list_reply;
    
    if (buttonReply || listReply) {
      // Handle button click
      const buttonId = buttonReply?.id ?? listReply?.id;

      if (!buttonId) {
        return new Response("OK", { status: 200 });
      }

      console.log("Button clicked:", buttonId);

      if (
        session.state === "awaiting_audit_selection" &&
        buttonId === RECOUNT_SELECTION_BACK_ID
      ) {
        await client.messages.sendInteractiveRaw({
          phoneNumberId,
          to: phoneNumber,
          interactive: getMainMenuButtons(),
        });

        await setSessionState(phoneNumber, "menu");
        return new Response("OK", { status: 200 });
      }

      if (
        session.state === "awaiting_audit_selection" &&
        buttonId.startsWith(RECOUNT_SELECTION_ROW_PREFIX)
      ) {
        const selectedId = Number(
          buttonId.slice(RECOUNT_SELECTION_ROW_PREFIX.length)
        );
        const sessionData =
          (session.session_data as Record<string, unknown> | undefined) || {};
        const options = getSelectionOptions(sessionData);
        const selectedRequest = options.find((request) => request.id === selectedId);

        if (!selectedRequest) {
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: "No pude identificar la solicitud seleccionada. Vuelve a intentarlo.",
          });

          const optionRows = options.slice(0, 9).map((request) => ({
            id: `${RECOUNT_SELECTION_ROW_PREFIX}${request.id}`,
            title: toListRowTitle(request),
            description: toListRowDescription(request),
          }));

          optionRows.push({
            id: RECOUNT_SELECTION_BACK_ID,
            title: "Volver al menu",
            description: "Regresar al menu principal",
          });

          await client.messages.sendInteractiveList({
            phoneNumberId,
            to: phoneNumber,
            bodyText: "Selecciona la solicitud a auditar:",
            buttonText: "Ver solicitudes",
            sections: [
              {
                title: "Solicitudes disponibles",
                rows: optionRows,
              },
            ],
          });

          return new Response("OK", { status: 200 });
        }

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: buildAuditDetailsMessage(selectedRequest),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: COUNT_INPUT_MESSAGE,
        });

        await setSessionState(phoneNumber, "awaiting_audit_count", {
          selected_recount_request: selectedRequest,
        });

        return new Response("OK", { status: 200 });
      }

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
      let newState:
        | "creating_product"
        | "creating_order"
        | "auditing"
        | "menu"
        | "awaiting_audit_selection"
        | "awaiting_audit_count"
        | "audit_count_confirm" = "menu";

      switch (buttonId) {
        case MENU_OPTIONS.CREATE_PRODUCT:
          newState = "creating_product";
          break;
        case MENU_OPTIONS.CREATE_ORDER:
          newState = "creating_order";
          break;
        case MENU_OPTIONS.START_AUDIT:
          const recountLookup = await getInventoryRecountByPhone(phoneNumber);

          if (!recountLookup.success) {
            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: "No se pudo obtener las solicitudes de reconteo. Intenta de nuevo en unos minutos.",
            });
            return new Response("OK", { status: 200 });
          }

          const recountRequests =
            recountLookup.recountRequests && recountLookup.recountRequests.length > 0
              ? (recountLookup.recountRequests as RecountRequestOption[])
              : recountLookup.recountRequest
                ? [recountLookup.recountRequest as RecountRequestOption]
                : [];

          if (recountRequests.length === 0) {
            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: "No tienes solicitudes de reconteo asignadas por ahora.",
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            await client.messages.sendInteractiveRaw({
              phoneNumberId,
              to: phoneNumber,
              interactive: getMainMenuButtons(),
            });

            await setSessionState(phoneNumber, "menu");
            return new Response("OK", { status: 200 });
          }

          if (recountRequests.length > 1) {
            const optionRows = recountRequests.slice(0, 9).map((request) => ({
              id: `${RECOUNT_SELECTION_ROW_PREFIX}${request.id}`,
              title: toListRowTitle(request),
              description: toListRowDescription(request),
            }));

            optionRows.push({
              id: RECOUNT_SELECTION_BACK_ID,
              title: "Volver al menu",
              description: "Regresar al menu principal",
            });

            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body:
                recountRequests.length > 9
                  ? "Tienes varias solicitudes de reconteo. Te muestro las primeras 9 para continuar."
                  : "Tienes varias solicitudes de reconteo asignadas.",
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            await client.messages.sendInteractiveList({
              phoneNumberId,
              to: phoneNumber,
              bodyText: "Selecciona la solicitud a auditar:",
              buttonText: "Ver solicitudes",
              sections: [
                {
                  title: "Solicitudes disponibles",
                  rows: optionRows,
                },
              ],
            });

            newState = "awaiting_audit_selection";
            await setSessionState(phoneNumber, newState, {
              recount_request_options: recountRequests,
            });
            return new Response("OK", { status: 200 });
          }

          const selectedRequest = recountRequests[0];

          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: buildAuditDetailsMessage(selectedRequest),
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
          await setSessionState(phoneNumber, newState, {
            selected_recount_request: selectedRequest,
          });
          return new Response("OK", { status: 200 });
          break;
        case MENU_OPTIONS.CONFIRM_AUDIT:
          // User confirmed the count - save and return to menu
          console.log("Audit confirmed, returning to menu");

          const confirmSessionData =
            (session.session_data as Record<string, unknown> | undefined) || {};
          const registeredCount =
            typeof confirmSessionData.audit_count === "string"
              ? confirmSessionData.audit_count
              : "N/A";
          const confirmedRequest =
            confirmSessionData.selected_recount_request &&
            typeof confirmSessionData.selected_recount_request === "object"
              ? (confirmSessionData.selected_recount_request as RecountRequestOption)
              : null;
          const expectedCount = confirmedRequest
            ? getRequestExpectedCount(confirmedRequest)
            : "N/A";

          const requestId = confirmedRequest?.id;
          const countValue = Number(registeredCount);

          if (!requestId || !Number.isFinite(countValue) || countValue < 0) {
            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: "No pude guardar el conteo. Intenta ingresarlo de nuevo.",
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: COUNT_INPUT_MESSAGE,
            });

            await setSessionState(phoneNumber, "awaiting_audit_count", {
              selected_recount_request: confirmedRequest || null,
            });

            return new Response("OK", { status: 200 });
          }

          await completeInventoryRecount(requestId, countValue);

          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: getCountConfirmationDetails(registeredCount, expectedCount),
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

    if (session.state === "awaiting_audit_selection" && textMessage) {
      const sessionData = session.session_data || {};
      const options = getSelectionOptions(sessionData);

      const optionRows = options.slice(0, 9).map((request) => ({
        id: `${RECOUNT_SELECTION_ROW_PREFIX}${request.id}`,
        title: toListRowTitle(request),
        description: toListRowDescription(request),
      }));

      optionRows.push({
        id: RECOUNT_SELECTION_BACK_ID,
        title: "Volver al menu",
        description: "Regresar al menu principal",
      });

      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: "Para seleccionar una solicitud, usa la lista.",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await client.messages.sendInteractiveList({
        phoneNumberId,
        to: phoneNumber,
        bodyText: "Selecciona la solicitud a auditar:",
        buttonText: "Ver solicitudes",
        sections: [
          {
            title: "Solicitudes disponibles",
            rows: optionRows,
          },
        ],
      });

      return new Response("OK", { status: 200 });
    }

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
        selected_recount_request:
          (session.session_data as Record<string, unknown>)?.selected_recount_request || null,
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
