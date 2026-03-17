/**
 * CAPTCHA Types and Interfaces
 * 
 * Defines all types for CAPTCHA detection and resolution
 */

export type CaptchaType = 
  | 'text-simple'
  | 'recaptcha-v2-grid'
  | 'recaptcha-v2-audio'
  | 'hcaptcha'
  | 'turnstile'
  | 'unknown';

export interface CaptchaConfig {
  enabled: boolean;
  autoSolve: boolean;
  visionProvider: 'gemini' | 'openai' | 'anthropic';
  visionModel: string;
  maxAttempts: number;
  maxRounds: number;
  apiKey?: string;
  enabledSites?: string[];
}

export interface CaptchaChallenge {
  type: CaptchaType;
  siteKey?: string;
  url?: string;
  instruction?: string;
  iframeSrc?: string;
  element?: unknown;
}

export interface CaptchaResult {
  success: boolean;
  solved: boolean;
  attempts: number;
  rounds: number;
  error?: string;
  response?: string;
  cellSelections?: number[][];
}

export interface CaptchaCell {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptchaGrid {
  rows: number;
  cols: number;
  cells: CaptchaCell[];
}

export interface VisionRequest {
  imageBase64?: string;
  audioBase64?: string;
  instruction?: string;
  challengeType: CaptchaType;
}

export interface VisionResponse {
  text?: string;
  cells?: number[];
  error?: string;
}

export const DEFAULT_CAPTCHA_CONFIG: CaptchaConfig = {
  enabled: false,
  autoSolve: true,
  visionProvider: 'gemini',
  visionModel: 'gemini-2.0-flash-exp',
  maxAttempts: 3,
  maxRounds: 5,
  enabledSites: [],
};

export const CAPTCHA_SELECTORS = {
  recaptcha: [
    '.g-recaptcha',
    '[data-sitekey]',
    'iframe[src*="google.com/recaptcha"]',
    'iframe[src*="google.com/recaptcha/api2/"]',
  ],
  hcaptcha: [
    '.h-captcha',
    '[data-sitekey]',
    'iframe[src*="hcaptcha.com"]',
    'iframe[src*="newassets.hcaptcha.com"]',
  ],
  turnstile: [
    '.cf-turnstile',
    '[data-sitekey]',
    'iframe[src*="challenges.cloudflare.com"]',
  ],
  textSimple: [
    'img[alt*="captcha"]',
    'img[class*="captcha"]',
    'input[name*="captcha"]',
    'input[id*="captcha"]',
  ],
  recaptchaCheckbox: [
    '.recaptcha-checkbox',
    '[id*="recaptcha-"]',
    'iframe[title*="reCAPTCHA"]',
  ],
  hcaptchaCheckbox: [
    '.hcaptcha-checkbox',
    '[id*="hcaptcha-"]',
    'iframe[title*="hCaptcha"]',
  ],
  turnstileWidget: [
    '.cf-turnstile',
    '[class*="turnstile"]',
    'iframe[title*="Cloudflare"]',
  ],
} as const;

export const CAPTCHA_PROMPTS = {
  textSimple: `Esta imagen es un CAPTCHA de texto. Contiene caracteres alfanuméricos distorsionados sobre un fondo con ruido. Tu tarea es leer exactamente los caracteres que aparecen en la imagen. Responde SOLO con los caracteres que ves, sin explicación, sin espacios extra, sin comillas. Si no puedes leer algún carácter con certeza, usa tu mejor estimación. Los caracteres posibles son: A-Z, a-z, 0-9.`,

  recaptchaGrid: `Estás viendo un challenge de reCAPTCHA. En la parte superior hay una instrucción que dice qué tipo de objeto debes seleccionar. Debajo hay un grid de imágenes numeradas. Tu tarea:
  
Paso 1: Lee la instrucción exacta del challenge (ejemplo: 'Selecciona todas las imágenes con autobuses').
Paso 2: Analiza cada celda del grid. Numera las celdas de izquierda a derecha, de arriba a abajo, empezando por 1.
Paso 3: Identifica cuáles celdas contienen el objeto solicitado.

Responde SOLO con los números de las celdas correctas, separados por comas. Ejemplo: 1,4,7
Si no estás seguro de una celda, inclúyela — es mejor seleccionar de más que de menos.
Si ninguna celda contiene el objeto, responde: ninguna`,

  hcaptcha: `Estás viendo un challenge de hCaptcha. La instrucción en la parte superior indica qué tipo de objeto debes seleccionar (ejemplo: 'Haz clic en cada imagen que contenga un avión'). Debajo hay un grid de imágenes.

Paso 1: Lee la instrucción exacta.
Paso 2: Numera las celdas de izquierda a derecha, de arriba a abajo, empezando por 1.
Paso 3: Identifica cuáles contienen el objeto solicitado.

Responde SOLO con los números separados por comas. Ejemplo: 2,5,8
Si ninguna celda aplica, responde: ninguna`,

  audioCaptcha: `Este es un audio de un challenge CAPTCHA. Contiene una secuencia de dígitos hablados en inglés con ruido de fondo y distorsión. Escucha con atención y transcribe SOLO los dígitos que escuchas, en orden, sin espacios. Ejemplo de respuesta: 49217`,
};
