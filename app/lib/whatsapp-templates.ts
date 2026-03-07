/**
 * WhatsApp message templates for BioCRowny bot
 */

// Message constants
export const WELCOME_MESSAGE =
  "Bienvenido a BioCRowny. Este bot te ayudará a gestionar tu inventario.";

export const ERROR_MESSAGE = "Algo salió mal. Por favor intenta de nuevo.";

export const PLACEHOLDER_MESSAGE = "Esta función estará disponible pronto.";

export const UNAUTHORIZED_MESSAGE =
  "Lo sentimos, no tienes autorización para usar este bot. Por favor contacta al administrador.";

// Menu option identifiers
export const MENU_OPTIONS = {
  START_AUDIT: "start_audit",
  CREATE_PRODUCT: "create_product",
  CREATE_ORDER: "create_order",
  CONFIRM_AUDIT: "confirm_audit",
  CORRECT_AUDIT: "correct_audit",
} as const;

// Audit flow messages
export const AUDIT_DETAILS_MESSAGE =
  "📋 *Detalles de Auditoría*\n\n" +
  "📍 *Ubicación:* Bodega A\n" +
  "📦 *Producto:* Caja de guantes \n" ;

export const COUNT_INPUT_MESSAGE =
  "Por favor, ingresa el conteo del producto:";

export function getAuditConfirmationMessage(count: string): string {
  return `El conteo registrado es: *${count}*`;
}

export const COUNT_CONFIRMATION_DETAILS_MESSAGE =
  "📋 *Detalles de Auditoría*\n\n" +
  "📍 *Ubicación:* Bodega A\n" +
  "📦 *Producto:* Caja de guantes \n" +
  "🔢 *Conteo registrado:* {count}\n" +
  "🔢 *Conteo esperado:* {count}\n\n" ;
/**
 * Get the main menu with interactive buttons
 * 
 * @returns Interactive button message configuration for Kapso WhatsApp API
 */
export function getMainMenuButtons() {
  return {
    type: "button" as const,
    body: {
      text: "Por favor selecciona una opción:",
    },
    action: {
      buttons: [
        {
          type: "reply" as const,
          reply: {
            id: MENU_OPTIONS.START_AUDIT,
            title: "Iniciar auditoría",
          },
        },
        {
          type: "reply" as const,
          reply: {
            id: MENU_OPTIONS.CREATE_PRODUCT,
            title: "Crear nuevo producto",
          },
        },
        {
          type: "reply" as const,
          reply: {
            id: MENU_OPTIONS.CREATE_ORDER,
            title: "Crear pedido",
          },
        },
      ],
    },
  };
}

/**
 * Get audit confirmation buttons (Confirmar/Corregir)
 * 
 * @returns Interactive button message configuration
 */
export function getAuditConfirmButtons() {
  return {
    type: "button" as const,
    body: {
      text: "¿Confirmas el conteo ingresado?",
    },
    action: {
      buttons: [
        {
          type: "reply" as const,
          reply: {
            id: MENU_OPTIONS.CONFIRM_AUDIT,
            title: "Confirmar",
          },
        },
        {
          type: "reply" as const,
          reply: {
            id: MENU_OPTIONS.CORRECT_AUDIT,
            title: "Corregir",
          },
        },
      ],
    },
  };
}

/**
 * Get placeholder response based on selected menu option
 * 
 * @param optionId - Menu option identifier
 * @returns Placeholder message with context
 */
export function getPlaceholderResponse(optionId: string): string {
  const optionNames: Record<string, string> = {
    [MENU_OPTIONS.START_AUDIT]: "Iniciar auditoría",
    [MENU_OPTIONS.CREATE_PRODUCT]: "Crear nuevo producto",
    [MENU_OPTIONS.CREATE_ORDER]: "Crear pedido",
  };

  const optionName = optionNames[optionId] || "esta opción";
  return `Has seleccionado: ${optionName}.\n\n${PLACEHOLDER_MESSAGE}`;
}

/**
 * Get welcome message text
 * 
 * @returns Welcome message string
 */
export function getWelcomeMessage(): string {
  return WELCOME_MESSAGE;
}

/**
 * Get generic error message
 * 
 * @returns Error message string
 */
export function getErrorMessage(): string {
  return ERROR_MESSAGE;
}

/**
 * Get unauthorized user message
 * 
 * @returns Unauthorized message string
 */
export function getUnauthorizedMessage(): string {
  return UNAUTHORIZED_MESSAGE;
}
