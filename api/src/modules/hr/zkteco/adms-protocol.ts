/**
 * ZKTeco ADMS / "iclock" push protocol (terminal → server over HTTP).
 *
 * The terminal calls, every few seconds:
 *   GET  /iclock/cdata?SN=…&options=all      handshake — we answer with upload options
 *   POST /iclock/cdata?SN=…&table=ATTLOG     attendance lines (we store them)
 *   POST /iclock/cdata?SN=…&table=OPERLOG    operation log / user & biometric records (discarded)
 *   GET  /iclock/getrequest?SN=…             command poll — we never send commands
 *   POST /iclock/devicecmd?SN=…              command results — acknowledged only
 *
 * TransFlag only enables "TransData AttLog": the terminal is asked NOT to upload users,
 * fingerprint templates, face templates or photos. Anything biometric that still arrives
 * is dropped without being stored.
 */

export const ADMS_ROUTES = {
  cdata: ['iclock/cdata', 'iclock/cdata.aspx'],
  getrequest: ['iclock/getrequest', 'iclock/getrequest.aspx'],
  devicecmd: ['iclock/devicecmd', 'iclock/devicecmd.aspx'],
} as const;

export const ADMS_ALL_PATHS = [...ADMS_ROUTES.cdata, ...ADMS_ROUTES.getrequest, ...ADMS_ROUTES.devicecmd];

export const ADMS_MAX_BODY = '5mb';

export type AdmsTable = 'ATTLOG' | 'OPERLOG' | 'ATTPHOTO' | 'OTHER';

export function admsTable(table: unknown): AdmsTable {
  const t = String(table ?? '').toUpperCase();
  if (t === 'ATTLOG') return 'ATTLOG';
  if (t === 'OPERLOG') return 'OPERLOG';
  if (t === 'ATTPHOTO') return 'ATTPHOTO';
  return 'OTHER';
}

/** Serial numbers are printed on the label: uppercase letters and digits. */
export function normaliseSerial(sn: unknown): string | null {
  const s = String(sn ?? '').trim().toUpperCase();
  return /^[A-Z0-9-]{4,40}$/.test(s) ? s : null;
}

export type AdmsOptions = {
  serialNumber: string;
  attlogStamp: string | null;
  /** Seconds between command polls */
  delaySeconds: number;
  /** Minutes between batch uploads when Realtime is off */
  transIntervalMinutes: number;
  timezoneHours: number;
};

export function admsHandshakeResponse(o: AdmsOptions): string {
  return [
    `GET OPTION FROM: ${o.serialNumber}`,
    `ATTLOGStamp=${o.attlogStamp && /^\d+$/.test(o.attlogStamp) ? o.attlogStamp : '0'}`,
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=9999',
    'ErrorDelay=60',
    `Delay=${o.delaySeconds}`,
    'TransTimes=00:00;12:00',
    `TransInterval=${o.transIntervalMinutes}`,
    'TransFlag=TransData AttLog',
    `TimeZone=${o.timezoneHours}`,
    'Realtime=1',
    'Encrypt=None',
  ].join('\n');
}

export function nonEmptyLineCount(body: string): number {
  let n = 0;
  for (const l of body.split(/\r?\n/)) if (l.trim()) n++;
  return n;
}

/** Bodies may arrive as text or Buffer depending on the terminal's Content-Type. */
export function bodyAsText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return '';
}
