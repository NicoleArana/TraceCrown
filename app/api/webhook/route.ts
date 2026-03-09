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
import { getInventoryRecountByPhone, RecountRequestWithProducts } from "../odoo/inventory-recount/[phone]/get-recount-by-phone";
import { completeInventoryRecount } from "../odoo/inventory-recount/complete-recount";

type RecountRequestOption = RecountRequestWithProducts;

type CountedProduct = {
  product_id: [number, string];
  quantity: number;
  location_id: [number, string];
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



function getRequestDisplayName(request: RecountRequestOption): string {
  return `Solicitud #${request.id}`;
}

function getRequestProduct(request: RecountRequestOption): string {
  const products = request.products || [];
  if (products.length === 0) return "No especificado";
  if (products.length === 1) return products[0].product_id[1];
  return `${products.length} productos`;
}

function getRequestLocation(request: RecountRequestOption): string {
  const products = request.products || [];
  if (products.length === 0) return "No especificada";
  if (products.length === 1) return products[0].location_id[1];
  const uniqueLocations = [...new Set(products.map(p => p.location_id[1]))];
  return uniqueLocations.join(", ");
}

function getRequestExpectedCount(request: RecountRequestOption): string {
  const products = request.products || [];
  if (products.length === 0) return "N/A";
  if (products.length === 1) return String(products[0].quantity);
  return `${products.length} productos`;
}

function buildAuditDetailsMessage(request: RecountRequestOption): string {
  const products = request.products || [];
  
  if (products.length === 0) {
    return (
      "📋 *Detalles de Auditoría*\n\n" +
      `🧾 *Solicitud:* ${getRequestDisplayName(request)}\n` +
      `📍 *Ubicación:* ${getRequestLocation(request)}\n` +
      `📦 *Producto:* ${getRequestProduct(request)}`
    );
  }

  let message = "📋 *Detalles de Auditoría*\n\n";
  message += `🧾 *Solicitud:* ${getRequestDisplayName(request)}\n`;
  message += `📍 *Ubicación:* ${getRequestLocation(request)}\n`;
  message += `📦 *Productos:* ${products.length}\n\n`;
  
  products.slice(0, 3).forEach((p, i) => {
    message += `${i + 1}. ${p.product_id[1]} (${p.quantity})\n`;
  });
  
  if (products.length > 3) {
    message += `... y ${products.length - 3} más`;
  }
  
  return message;
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


function getCountedProducts(sessionData: Record<string, unknown>): CountedProduct[] {
  const raw = sessionData.counted_products;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is CountedProduct =>
      typeof item === "object" && item !== null && Array.isArray(item.product_id)
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

        const products = selectedRequest.products || [];

        if (products.length === 0) {
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: "Esta solicitud no tiene productos asociados.",
          });
          await setSessionState(phoneNumber, "menu");
          return new Response("OK", { status: 200 });
        }

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: buildAuditDetailsMessage(selectedRequest),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        if (products.length > 1) {
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: `Esta solicitud tiene ${products.length} productos. Por favor ingresa el conteo de cada uno.\n\n*Comenzando con el primer producto:*`,
          });

          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const firstProduct = products[0];
        const firstProductData = {
          id: firstProduct.id,
          name: firstProduct.product_id[1],
          quantity: firstProduct.quantity,
          location: firstProduct.location_id[1],
          locationId: firstProduct.location_id[0],
        };

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: `Por favor, ingresa el conteo del producto "${firstProductData.name}":`,
        });

        await setSessionState(phoneNumber, "awaiting_audit_count", {
          selected_recount_request: selectedRequest,
          current_product_data: firstProductData,
          current_product_index: 0,
          counted_products: [],
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
        | "awaiting_product_selection"
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

          const recountRequests = recountLookup.recountRequests || [];

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
          const products = selectedRequest.products || [];

          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: buildAuditDetailsMessage(selectedRequest),
          });

          await new Promise((resolve) => setTimeout(resolve, 500));

          if (products.length > 1) {
            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: `Esta solicitud tiene ${products.length} productos. Por favor ingresa el conteo de cada uno.\n\n*Comenzando con el primer producto:*`,
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            const firstProduct = products[0];
            const firstProductData = {
              id: firstProduct.id,
              name: firstProduct.product_id[1],
              quantity: firstProduct.quantity,
              location: firstProduct.location_id[1],
              locationId: firstProduct.location_id[0],
            };

            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: `Por favor, ingresa el conteo del producto "${firstProductData.name}":`,
            });

            await setSessionState(phoneNumber, "awaiting_audit_count", {
              selected_recount_request: selectedRequest,
              current_product_data: firstProductData,
              current_product_index: 0,
              counted_products: [],
            });

            return new Response("OK", { status: 200 });
          }

          if (products.length === 1) {
            const singleProduct = products[0];
            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: `Por favor, ingresa el conteo del producto "${singleProduct.product_id[1]}":`,
            });

            const singleProductData = {
              id: singleProduct.id,
              name: singleProduct.product_id[1],
              quantity: singleProduct.quantity,
              location: singleProduct.location_id[1],
              locationId: singleProduct.location_id[0],
            };

            await setSessionState(phoneNumber, "awaiting_audit_count", {
              selected_recount_request: selectedRequest,
              current_product_data: singleProductData,
              current_product_index: 0,
              counted_products: [],
            });

            return new Response("OK", { status: 200 });
          }

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
          console.log("Audit confirmed, returning to menu");

          const confirmSessionData =
            (session.session_data as Record<string, unknown> | undefined) || {};
          const countedProducts = getCountedProducts(confirmSessionData);
          const confirmedRequest =
            confirmSessionData.selected_recount_request &&
            typeof confirmSessionData.selected_recount_request === "object"
              ? (confirmSessionData.selected_recount_request as RecountRequestOption)
              : null;

          if (!confirmedRequest) {
            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: "No tengo información del reconteo. Regresa al menú e intenta de nuevo.",
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

          const requestId = confirmedRequest.id;

          if (countedProducts.length > 0) {
            const countsByQuant: Record<number, number> = {};
            for (const countedProduct of countedProducts) {
              const quantId = countedProduct.location_id[0];
              countsByQuant[quantId] = countedProduct.quantity;
            }

            try {
              await completeInventoryRecount(requestId, undefined, countsByQuant);

              const results = countedProducts.map(
                (p) => `✅ ${p.product_id[1]}: ${p.quantity}`
              );
              const summary = "📊 *Resultado del reconteo*\n\n" + results.join("\n");

              await client.messages.sendText({
                phoneNumberId,
                to: phoneNumber,
                body: summary,
              });
            } catch (error) {
              console.error("Error completing recount:", error);
              const results = countedProducts.map(
                (p) => `❌ ${p.product_id[1]}: ${p.quantity}`
              );
              const summary = "📊 *Resultado del reconteo*\n\n" + results.join("\n");

              await client.messages.sendText({
                phoneNumberId,
                to: phoneNumber,
                body: summary,
              });
            }
          } else {
            const registeredCount =
              typeof confirmSessionData.audit_count === "string"
                ? confirmSessionData.audit_count
                : "N/A";
            const expectedCount = confirmedRequest
              ? getRequestExpectedCount(confirmedRequest)
              : "N/A";

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
          }

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
      console.log("Received audit count:", textMessage);

      const sessionData = session.session_data as Record<string, unknown> | undefined;
      const selectedRequest = sessionData?.selected_recount_request as RecountRequestOption | undefined;
      const currentProductData = sessionData?.current_product_data as { id: number; name: string; quantity: number; location: string; locationId: number } | undefined;
      const currentProductIndex = typeof sessionData?.current_product_index === 'number' ? sessionData.current_product_index : 0;
      const countedProducts = getCountedProducts(sessionData || {});

      if (currentProductData && selectedRequest) {
        const newCountedProduct: CountedProduct = {
          product_id: [0, currentProductData.name],
          quantity: Number(textMessage),
          location_id: [currentProductData.locationId, currentProductData.location],
        };

        const allProducts = selectedRequest.products || [];
        const updatedCountedProducts = [...countedProducts, newCountedProduct];
        const nextProductIndex = currentProductIndex + 1;
        const hasMoreProducts = nextProductIndex < allProducts.length;

        if (hasMoreProducts) {
          const nextProduct = allProducts[nextProductIndex];
          const nextProductData = {
            id: nextProduct.id,
            name: nextProduct.product_id[1],
            quantity: nextProduct.quantity,
            location: nextProduct.location_id[1],
            locationId: nextProduct.location_id[0],
          };

          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: `✅ *Conteo registrado*\n\n"${currentProductData.name}": ${textMessage}\n\n*Producto ${nextProductIndex + 1} de ${allProducts.length}*`,
          });

          await new Promise((resolve) => setTimeout(resolve, 500));

          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: `Por favor, ingresa el conteo del producto "${nextProductData.name}":`,
          });

          await setSessionState(phoneNumber, "awaiting_audit_count", {
            selected_recount_request: selectedRequest,
            current_product_data: nextProductData,
            current_product_index: nextProductIndex,
            counted_products: updatedCountedProducts,
          });

          return new Response("OK", { status: 200 });
        }

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: `✅ *Conteo registrado*\n\n"${currentProductData.name}": ${textMessage}\n\n*¡Has terminado de contar todos los productos!*`,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        const summaryMessage = "📋 *Resumen del reconteo*\n\n" +
          updatedCountedProducts.map((p, i) => 
            `${i + 1}. ${p.product_id[1]}: ${p.quantity}`
          ).join("\n");

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: summaryMessage,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await client.messages.sendInteractiveRaw({
          phoneNumberId,
          to: phoneNumber,
          interactive: getAuditConfirmButtons(),
        });

        await setSessionState(phoneNumber, "audit_count_confirm", {
          audit_count: textMessage,
          selected_recount_request: selectedRequest,
          counted_products: updatedCountedProducts,
        });

        console.log("Audit count confirmation sent (multi-product)");
        return new Response("OK", { status: 200 });
      }

      if (currentProductData) {
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

        await setSessionState(phoneNumber, "audit_count_confirm", {
          audit_count: textMessage,
          selected_recount_request: selectedRequest,
        });

        console.log("Audit count confirmation sent");
        return new Response("OK", { status: 200 });
      }

      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: COUNT_INPUT_MESSAGE,
      });

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
