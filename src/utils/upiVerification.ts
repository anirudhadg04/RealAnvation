export const PAYMENT_UPI_ID = (typeof process !== 'undefined' && process.env.PAYMENT_UPI_ID)
  || import.meta.env?.VITE_PAYMENT_UPI_ID
  || 'fcbizdgbveu@freecharge';

const TRANSACTION_ID_PATTERN = /(?<!\d)\d{12}(?!\d)/g;

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

// Extract all 12-digit numbers from OCR text (UTR candidates)
// ONLY the UTR is authoritative - recipient UPI ID, bank names, etc. are ignored
export function extractTransactionIds(ocrText: string): string[] {
  const normalized = normalizeOcrDigits(ocrText);
  const matches = normalized.match(TRANSACTION_ID_PATTERN);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

export function ocrContainsTransactionId(ocrText: string, transactionId: string): { matched: boolean; detectedUtr?: string; error?: string } {
  const candidates = extractTransactionIds(ocrText);
  
  if (candidates.length === 0) {
    return { matched: false, error: "Could not detect the UTR from the screenshot. Please upload a clearer payment screenshot." };
  }
  
  // Exact match first
  if (candidates.some((candidate) => candidate === transactionId)) {
    return { matched: true, detectedUtr: transactionId };
  }
  
  // Fuzzy match for OCR tolerance (allow up to 2 digit differences)
  const fuzzyMatch = candidates.find((candidate) => fuzzyMatchUtr(candidate, transactionId));
  if (fuzzyMatch) {
    return { matched: true, detectedUtr: fuzzyMatch };
  }
  
  // No match found - return the first detected UTR for error message
  return { 
    matched: false, 
    detectedUtr: candidates[0],
    error: "The UTR entered does not match the UTR detected in the payment screenshot."
  };
}
