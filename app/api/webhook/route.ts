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
import { getInventoryRecountByPhone, RecountProduct, RecountRequestWithProducts } from "../odoo/inventory-recount/[phone]/get-recount-by-phone";
import { completeInventoryRecount } from "../odoo/inventory-recount/complete-recount";

type RecountRequestOption = RecountRequestWithProducts;

type CountedProduct = {
  product_id: [number, string];
  quantity: number;
  location_id: [number, string];
};

const RECOUNT_SELECTION_ROW_PREFIX = "select_recount_";
const RECOUNT_SELECTION_BACK_ID = "recount_back_to_menu";

const PRODUCT_SELECTION_ROW_PREFIX = "select_product_";

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

function getProductDisplayName(product: RecountProduct): string {
  return product.product_id[1];
}

function getProductLocation(product: RecountProduct): string {
  return product.location_id[1];
}

function getProductExpectedQty(product: RecountProduct): string {
  return String(product.quantity);
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

function buildProductDetailsMessage(product: RecountProduct): string {
  return (
    "📦 *Producto a contar*\n\n" +
    `*Nombre:* ${getProductDisplayName(product)}\n` +
    `📍 *Ubicación:* ${getProductLocation(product)}\n` +
    `📊 *Cantidad esperada:* ${getProductExpectedQty(product)}`
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

function getProductSelectionOptions(sessionData: Record<string, unknown>): RecountProduct[] {
  const raw = sessionData.product_options;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is RecountProduct =>
      typeof item === "object" && item !== null && typeof (item as { product_id?: unknown }).product_id === "object"
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
          const productRows = products.slice(0, 9).map((product) => ({
            id: `${PRODUCT_SELECTION_ROW_PREFIX}${product.id}`,
            title: getProductDisplayName(product).slice(0, 24),
            description: `Cant: ${product.quantity} | ${getProductLocation(product).slice(0, 20)}`,
          }));

          productRows.push({
            id: RECOUNT_SELECTION_BACK_ID,
            title: "Volver",
            description: "Cambiar solicitud",
          });

          await client.messages.sendInteractiveList({
            phoneNumberId,
            to: phoneNumber,
            bodyText: "Esta solicitud tiene varios productos. Selecciona uno para contar:",
            buttonText: "Ver productos",
            sections: [
              {
                title: "Productos",
                rows: productRows,
              },
            ],
          });

          await setSessionState(phoneNumber, "awaiting_product_selection", {
            selected_recount_request: selectedRequest,
            product_options: products,
            counted_products: [],
          });

          return new Response("OK", { status: 200 });
        }

        const singleProduct = products[0];
        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: buildProductDetailsMessage(singleProduct),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: COUNT_INPUT_MESSAGE,
        });

        await setSessionState(phoneNumber, "awaiting_audit_count", {
          selected_recount_request: selectedRequest,
          current_product: singleProduct,
          counted_products: [],
        });

        return new Response("OK", { status: 200 });
      }

      if (
        session.state === "awaiting_product_selection" &&
        buttonId === RECOUNT_SELECTION_BACK_ID
      ) {
        const sessionData =
          (session.session_data as Record<string, unknown> | undefined) || {};
        const options = getSelectionOptions(sessionData);

        if (options.length === 0) {
          await client.messages.sendInteractiveRaw({
            phoneNumberId,
            to: phoneNumber,
            interactive: getMainMenuButtons(),
          });
          await setSessionState(phoneNumber, "menu");
          return new Response("OK", { status: 200 });
        }

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
          body: "Selecciona la solicitud a auditar:",
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

        await setSessionState(phoneNumber, "awaiting_audit_selection", {
          recount_request_options: options,
        });

        return new Response("OK", { status: 200 });
      }

      if (
        session.state === "awaiting_product_selection" &&
        buttonId.startsWith(PRODUCT_SELECTION_ROW_PREFIX)
      ) {
        const selectedProductId = Number(
          buttonId.slice(PRODUCT_SELECTION_ROW_PREFIX.length)
        );
        const sessionData =
          (session.session_data as Record<string, unknown> | undefined) || {};
        const productOptions = getProductSelectionOptions(sessionData);
        const selectedProduct = productOptions.find((p) => p.id === selectedProductId);
        const selectedRequest = sessionData.selected_recount_request as RecountRequestOption | undefined;

        if (!selectedProduct || !selectedRequest) {
          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: "No pude identificar el producto seleccionado. Vuelve a intentarlo.",
          });
          await setSessionState(phoneNumber, "menu");
          return new Response("OK", { status: 200 });
        }

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: buildProductDetailsMessage(selectedProduct),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: COUNT_INPUT_MESSAGE,
        });

        await setSessionState(phoneNumber, "awaiting_audit_count", {
          selected_recount_request: selectedRequest,
          current_product: selectedProduct,
          counted_products: getCountedProducts(sessionData),
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
            const results: string[] = [];

            for (const countedProduct of countedProducts) {
              try {
                await completeInventoryRecount(requestId, countedProduct.quantity);
                results.push(`✅ ${countedProduct.product_id[1]}: ${countedProduct.quantity}`);
              } catch (error) {
                console.error("Error completing recount for product:", error);
                results.push(`❌ ${countedProduct.product_id[1]}: ${countedProduct.quantity} (error)`);
              }
            }

            const summary = "📊 *Resultado del reconteo*\n\n" + results.join("\n");

            await client.messages.sendText({
              phoneNumberId,
              to: phoneNumber,
              body: summary,
            });
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

    if (session.state === "awaiting_product_selection" && textMessage) {
      const sessionData = session.session_data as Record<string, unknown> | undefined;
      const productOptions = getProductSelectionOptions(sessionData || {});
      const selectedRequest = sessionData?.selected_recount_request as RecountRequestOption | undefined;

      if (productOptions.length === 0 || !selectedRequest) {
        await client.messages.sendInteractiveRaw({
          phoneNumberId,
          to: phoneNumber,
          interactive: getMainMenuButtons(),
        });
        await setSessionState(phoneNumber, "menu");
        return new Response("OK", { status: 200 });
      }

      const productRows = productOptions.slice(0, 9).map((product) => ({
        id: `${PRODUCT_SELECTION_ROW_PREFIX}${product.id}`,
        title: getProductDisplayName(product).slice(0, 24),
        description: `Cant: ${product.quantity} | ${getProductLocation(product).slice(0, 20)}`,
      }));

      await client.messages.sendText({
        phoneNumberId,
        to: phoneNumber,
        body: "Para seleccionar un producto, usa la lista.",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await client.messages.sendInteractiveList({
        phoneNumberId,
        to: phoneNumber,
        bodyText: "Selecciona el producto a contar:",
        buttonText: "Ver productos",
        sections: [
          {
            title: "Productos",
            rows: productRows,
          },
        ],
      });

      return new Response("OK", { status: 200 });
    }

    if (session.state === "awaiting_audit_count" && textMessage) {
      console.log("Received audit count:", textMessage);

      const sessionData = session.session_data as Record<string, unknown> | undefined;
      const selectedRequest = sessionData?.selected_recount_request as RecountRequestOption | undefined;
      const currentProduct = sessionData?.current_product as RecountProduct | undefined;
      const countedProducts = getCountedProducts(sessionData || {});

      if (currentProduct) {
        const newCountedProduct: CountedProduct = {
          product_id: currentProduct.product_id,
          quantity: Number(textMessage),
          location_id: currentProduct.location_id,
        };

        const allProducts = selectedRequest?.products || [];
        const remainingProducts = allProducts.filter(
          (p) => !countedProducts.some((cp) => cp.product_id[0] === p.product_id[0]) &&
                 p.product_id[0] !== currentProduct.product_id[0]
        );

        const updatedCountedProducts = [...countedProducts, newCountedProduct];

        if (remainingProducts.length > 0) {
          const productRows = remainingProducts.slice(0, 9).map((product) => ({
            id: `${PRODUCT_SELECTION_ROW_PREFIX}${product.id}`,
            title: getProductDisplayName(product).slice(0, 24),
            description: `Cant: ${product.quantity} | ${getProductLocation(product).slice(0, 20)}`,
          }));

          await client.messages.sendText({
            phoneNumberId,
            to: phoneNumber,
            body: `✅ *Conteo registrado*\n\nProducto: ${currentProduct.product_id[1]}\nCantidad ingresada: ${textMessage}\n\n*Productos restantes: ${remainingProducts.length}*`,
          });

          await new Promise((resolve) => setTimeout(resolve, 500));

          await client.messages.sendInteractiveList({
            phoneNumberId,
            to: phoneNumber,
            bodyText: "Selecciona el siguiente producto:",
            buttonText: "Ver productos",
            sections: [
              {
                title: "Productos restantes",
                rows: productRows,
              },
            ],
          });

          await setSessionState(phoneNumber, "awaiting_product_selection", {
            selected_recount_request: selectedRequest,
            product_options: remainingProducts,
            counted_products: updatedCountedProducts,
          });

          return new Response("OK", { status: 200 });
        }

        await client.messages.sendText({
          phoneNumberId,
          to: phoneNumber,
          body: `✅ *Conteo registrado*\n\nProducto: ${currentProduct.product_id[1]}\nCantidad ingresada: ${textMessage}\n\n*¡Has terminado de contar todos los productos!*`,
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
          current_product: currentProduct,
        });

        console.log("Audit count confirmation sent (multi-product)");
        return new Response("OK", { status: 200 });
      }

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
