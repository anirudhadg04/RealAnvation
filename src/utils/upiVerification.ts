export const PAYMENT_UPI_ID = (typeof process !== 'undefined' && process.env.PAYMENT_UPI_ID)
  || import.meta.env?.VITE_PAYMENT_UPI_ID
  || 'fcbizdgbveu@freecharge';

const TRANSACTION_ID_PATTERN = /(?<!\d)\d{12}(?!\d)/g;
const EXPLICIT_UTR_PATTERN = /(?:^|\n)\s*utr\s*[:#-]?\s*(\d{12})(?!\d)/gim;
const EXPLICIT_UPI_TRANSACTION_PATTERN = /(?:^|\n)\s*upi\s+transaction\s+id\s*[:#-]?\s*(\d{12})(?!\d)/gim;
const EXCLUDED_TRANSACTION_LABEL_PATTERN = /google\s+transaction\s+id|transaction\s+id\s*\(google\)|bank\s+(?:reference|transaction)\s+number/i;

// Normalize common OCR character confusions for digit matching
function normalizeOcrDigits(text: string): string {
  return text
    .replace(/[OoDQ]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Z]/g, '2')
    .replace(/[B]/g, '8')
    .replace(/[Ss]/g, '5')
    .replace(/[Gb]/g, '6')
    .replace(/[T]/g, '7')
    .replace(/[g]/g, '9');
}

// Fuzzy match: allows up to 2 digit differences for OCR tolerance
function fuzzyMatchUtr(candidate: string, target: string): boolean {
  if (candidate.length !== target.length) return false;
  let diffs = 0;
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== target[i]) diffs++;
    if (diffs > 2) return false;
  }
  return true;
}

export function extractTransactionIds(ocrText: string): string[] {
  const normalized = normalizeOcrDigits(ocrText);
  const explicitUtr = Array.from(normalized.matchAll(EXPLICIT_UTR_PATTERN), (match) => match[1]);
  if (explicitUtr.length) return Array.from(new Set(explicitUtr));
  const explicitUpiTransaction = Array.from(normalized.matchAll(EXPLICIT_UPI_TRANSACTION_PATTERN), (match) => match[1]);
  if (explicitUpiTransaction.length) return Array.from(new Set(explicitUpiTransaction));

  const lines = normalized.split(/\r?\n/);
  return Array.from(new Set(lines
    .filter((line) => !EXCLUDED_TRANSACTION_LABEL_PATTERN.test(line))
    .flatMap((line) => line.match(TRANSACTION_ID_PATTERN) || [])));
}

export function ocrContainsTransactionId(ocrText: string, transactionId: string): boolean {
  const candidates = extractTransactionIds(ocrText);
  // Exact match first
  if (candidates.some((candidate) => candidate === transactionId)) return true;
  // Fuzzy match for OCR tolerance (allow up to 2 digit differences)
  return candidates.some((candidate) => fuzzyMatchUtr(candidate, transactionId));
}
