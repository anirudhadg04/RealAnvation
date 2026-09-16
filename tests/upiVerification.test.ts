import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTransactionIdsFromText, ocrContainsTransactionId } from '../src/utils/upiVerification';

test('extractTransactionIdsFromText extracts all 12-digit numbers from OCR text', () => {
  const ocr = 'UPI transaction ID\n129346921001\nTo: KSSEM';
  assert.deepEqual(extractTransactionIdsFromText(ocr), ['129346921001']);
});

test('extractTransactionIdsFromText extracts multiple 12-digit numbers when present', () => {
  const ocr = 'Google transaction ID\n304219207040\nUTR: 129346921001\nUPI transaction ID 304219207041';
  assert.deepEqual(extractTransactionIdsFromText(ocr), ['304219207040', '129346921001', '304219207041']);
});

test('ocrContainsTransactionId returns matched=true when exact match found', () => {
  const result = ocrContainsTransactionId('UPI transaction ID\n129346921001\nTo: KSSEM', '129346921001');
  assert.equal(result.matched, true);
  assert.equal(result.detectedUtr, '129346921001');
});

test('ocrContainsTransactionId returns matched=true with fuzzy match (up to 2 digit differences)', () => {
  const result = ocrContainsTransactionId('129346921000', '129346921001');
  assert.equal(result.matched, true);
  assert.equal(result.detectedUtr, '129346921000');
});

test('ocrContainsTransactionId returns matched=false when no 12-digit number found', () => {
  const result = ocrContainsTransactionId('no numbers here', '129346921001');
  assert.equal(result.matched, false);
  assert.ok(result.error?.includes('Could not detect'));
});

test('ocrContainsTransactionId returns matched=false when UTR does not match any candidate', () => {
  const result = ocrContainsTransactionId('129346921000', '129346921001');
  // Actually this should match with fuzzy - let's test a clear mismatch
  const result2 = ocrContainsTransactionId('111111111111', '129346921001');
  assert.equal(result2.matched, false);
  assert.ok(result2.error?.includes('does not match'));
});

test('ocrContainsTransactionId supports UPI transaction ID format', () => {
  const result = ocrContainsTransactionId('UPI transaction ID 129346921001', '129346921001');
  assert.equal(result.matched, true);
  assert.equal(result.detectedUtr, '129346921001');
});

test('extractTransactionIdsFromText supports UPI transaction ID format', () => {
  assert.deepEqual(extractTransactionIdsFromText('UPI transaction ID 129346921001'), ['129346921001']);
});

test('extractTransactionIdsFromText normalizes OCR digit confusions', () => {
  assert.deepEqual(extractTransactionIdsFromText('UTP: 12934692I00I'), ['129346921001']); // I -> 1
  assert.deepEqual(extractTransactionIdsFromText('UTR: 029346921001'), ['029346921001']); // O -> 0
});