import { createWorker } from 'tesseract.js';

let ocrWorkerPromise: Promise<Tesseract.Worker> | null = null;

function getOcrWorker(): Promise<Tesseract.Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng').catch((error: Error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

export async function extractTextFromImage(imageFile: File): Promise<string> {
  const worker = await getOcrWorker();
  
  const result = await worker.recognize(imageFile, {
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:./-# ',
    preserve_interword_spaces: '1'
  } as any);

  return String(result?.data?.text || '').trim();
}

export async function extractUtrFromImage(imageFile: File): Promise<{ text: string; utrCandidates: string[] }> {
  const text = await extractTextFromImage(imageFile);
  const utrCandidates = extractTransactionIdsFromText(text);
  return { text, utrCandidates };
}

const TRANSACTION_ID_PATTERN = /(?<!\d)\d{12}(?!\d)/g;

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

export function extractTransactionIdsFromText(ocrText: string): string[] {
  const normalized = normalizeOcrDigits(ocrText);
  const matches = normalized.match(TRANSACTION_ID_PATTERN);
  if (!matches) return [];
  return Array.from(new Set(matches));
}