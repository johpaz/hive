const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUserEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("El correo electrónico es obligatorio.");
  const email = value.trim().toLowerCase();
  if (!email) throw new Error("El correo electrónico es obligatorio.");
  if (email.length > 254 || !SIMPLE_EMAIL_PATTERN.test(email)) {
    throw new Error("Ingresa un correo electrónico válido.");
  }
  return email;
}
