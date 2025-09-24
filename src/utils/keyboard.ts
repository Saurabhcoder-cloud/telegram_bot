import { KeyboardButton, ReplyKeyboardMarkup } from "node-telegram-bot-api";

export const NAV_PREV = "◀️ Prev";
export const NAV_NEXT = "▶️ Next";
export const NAV_CANCEL = "❌ Cancel";
export const NAV_BACK = "🔙 Back";

export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) {
    return [arr.slice()];
  }
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

export function paginate(items: string[], page: number, pageSize: number): {
  pageItems: string[];
  totalPages: number;
} {
  if (items.length === 0) {
    return { pageItems: [], totalPages: 1 };
  }
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = currentPage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { pageItems, totalPages };
}

export function buildKeyboard(
  items: string[],
  page: number,
  totalPages: number,
  _ctxLabel: "country" | "state",
): ReplyKeyboardMarkup {
  const keyboardRows: KeyboardButton[][] = [];
  const itemRows = chunk(items, items.length > 4 ? 3 : 2);
  itemRows.forEach((row) => {
    keyboardRows.push(row.map((item) => ({ text: item })));
  });

  const navRow: KeyboardButton[] = [];
  if (totalPages > 1 && page > 0) {
    navRow.push({ text: NAV_PREV });
  }
  if (totalPages > 1 && page < totalPages - 1) {
    navRow.push({ text: NAV_NEXT });
  }
  if (navRow.length > 0) {
    keyboardRows.push(navRow);
  }

  keyboardRows.push([
    { text: NAV_BACK },
    { text: NAV_CANCEL },
  ]);

  return {
    keyboard: keyboardRows,
    resize_keyboard: true,
    one_time_keyboard: false,
    selective: true,
  };
}
