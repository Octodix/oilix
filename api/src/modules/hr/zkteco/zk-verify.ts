/**
 * ZKTeco "verify" codes as documented for the push (ADMS) protocol. The raw code is always
 * stored, so the mapping can be corrected once a real fingerprint/card punch confirms it.
 */
const VERIFY_CODES: Record<number, string> = {
  0: 'PIN',
  1: 'FINGERPRINT',
  2: 'CARD',
  3: 'PIN',
  4: 'CARD',
  15: 'FACE',
  25: 'PALM',
};

export const VERIFY_METHODS = ['FINGERPRINT', 'CARD', 'PIN', 'FACE', 'PALM', 'OTHER', 'UNKNOWN', 'MANUAL'] as const;

export function verifyMethodOf(code: number | null | undefined): string {
  if (code === null || code === undefined || Number.isNaN(code)) return 'UNKNOWN';
  return VERIFY_CODES[code] ?? 'OTHER';
}
