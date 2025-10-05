export function normalizeUsPhone(input: string): string {
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.startsWith('+1') && digits.length === 12) {
    return digits;
  }
  throw new Error('Invalid US phone number');
}
