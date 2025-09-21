export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const [year, month, day] = value.split("-").map(Number);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function normalizePhone(input: string): string {
  return input.replace(/[^\d+]/g, "").replace(/^00/, "+");
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 20;
}

export function isValidState(value: string): boolean {
  return /^[A-Za-z]{2}$/.test(value.trim().toUpperCase());
}
