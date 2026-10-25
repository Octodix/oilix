import * as net from 'net';
import {
  admsHandshakeResponse,
  admsIsLegacyFirmware,
  admsTable,
  normaliseSerial,
} from './adms-protocol';
import {
  coerceColumnMap,
  normaliseDeviceTime,
  parseAttendanceText,
  punchDedupeKey,
  ZK_ATTLOG_COLUMNS,
} from './attlog-parser';
import { providerFor } from './attendance-provider';
import { parseZkPayload, probeZkSdk, ZK, zkChecksum, zkPacket, zkTcpFrame } from './zk-sdk-probe';
import { verifyMethodOf } from './zk-verify';

const OFFSET = 60;

describe('attendance file / ATTLOG parser', () => {
  it('parses ZKTeco attlog lines (tab separated, padded PIN)', () => {
    const text = [
      '        1\t2026-10-07 07:53:12\t0\t1\t0\t0',
      '       12\t2026-10-07 08:20:05\t0\t4\t\t0',
      '        1\t2026-10-07 16:04:59\t1\t1\t0\t0',
    ].join('\r\n');
    const r = parseAttendanceText(text, ZK_ATTLOG_COLUMNS, OFFSET);
    expect(r.invalid).toEqual([]);
    expect(r.records).toHaveLength(3);
    expect(r.records[0]).toMatchObject({
      deviceUserId: '1',
      localTime: '2026-10-07 07:53:12',
      punchState: 0,
      verifyCode: 1,
      verifyMethod: 'FINGERPRINT',
    });
    expect(r.records[0].punchedAt.toISOString()).toBe('2026-10-07T06:53:12.000Z');
    expect(r.records[1].verifyMethod).toBe('CARD');
    expect(r.records[2].punchState).toBe(1);
  });

  it('skips a header row and reports invalid lines without failing the file', () => {
    const text = [
      'No;Date/Heure;Etat',
      '5;07/10/2026 07:59;0',
      'abc def;31/02/2026 08:00;0',
      '6;2026-13-01 08:00;0',
    ].join('\n');
    const r = parseAttendanceText(text, { pin: 0, time: 1, status: 2, delimiter: 'auto', dateOrder: 'DMY' }, OFFSET);
    expect(r.skippedHeader).toBe(true);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ deviceUserId: '5', localTime: '2026-10-07 07:59:00' });
    expect(r.invalid.map((i) => i.reason)).toEqual(['INVALID_USER_ID', 'INVALID_DATETIME']);
  });

  it('keeps "date time" together in whitespace-separated exports', () => {
    const r = parseAttendanceText('7 2026-10-07 07:55:00 0 1', { pin: 0, time: 1, status: 2, verify: 3, delimiter: 'whitespace' }, OFFSET);
    expect(r.records[0]).toMatchObject({ deviceUserId: '7', localTime: '2026-10-07 07:55:00', punchState: 0, verifyCode: 1 });
  });

  it('normalises DMY and MDY dates only when the year comes last', () => {
    expect(normaliseDeviceTime('2026/10/07 7:05')).toBe('2026-10-07 07:05:00');
    expect(normaliseDeviceTime('07/10/2026 07:05:09', 'DMY')).toBe('2026-10-07 07:05:09');
    expect(normaliseDeviceTime('10/07/2026 07:05:09', 'MDY')).toBe('2026-10-07 07:05:09');
    expect(normaliseDeviceTime('yesterday')).toBeNull();
  });

  it('same punch from two syncs ⇒ same dedupe key', () => {
    const line = '        1\t2026-10-07 07:53:12\t0\t1\t0\t0';
    const a = parseAttendanceText(line, ZK_ATTLOG_COLUMNS, OFFSET).records[0];
    const b = parseAttendanceText(`1\t2026-10-07 07:53:12\t0\t1`, ZK_ATTLOG_COLUMNS, OFFSET).records[0];
    expect(punchDedupeKey('dev', a.deviceUserId, a.localTime)).toBe(punchDedupeKey('dev', b.deviceUserId, b.localTime));
    expect(punchDedupeKey('dev', '1', a.localTime)).not.toBe(punchDedupeKey('other', '1', a.localTime));
  });

  it('coerces untrusted column maps', () => {
    expect(coerceColumnMap({ pin: 2, time: 'x', verify: null, delimiter: 'evil' })).toMatchObject({
      pin: 2,
      time: 1,
      verify: null,
      delimiter: 'auto',
    });
  });

  it('maps verify codes and keeps unknown ones explicit', () => {
    expect(verifyMethodOf(1)).toBe('FINGERPRINT');
    expect(verifyMethodOf(15)).toBe('FACE');
    expect(verifyMethodOf(99)).toBe('OTHER');
    expect(verifyMethodOf(null)).toBe('UNKNOWN');
  });
});

describe('ADMS protocol', () => {
  it('handshake asks for attendance logs only (no users / templates / photos)', () => {
    const r = admsHandshakeResponse({
      serialNumber: 'CQU4233560067',
      attlogStamp: '42',
      delaySeconds: 30,
      transIntervalMinutes: 1,
      timezoneHours: 1,
    });
    expect(r).toContain('GET OPTION FROM: CQU4233560067');
    expect(r).toContain('ATTLOGStamp=42');
    expect(r).toContain('Stamp=42');
    expect(r).toContain('TransFlag=TransData AttLog');
    expect(r).not.toMatch(/EnrollFP|OpLog\b|AttPhoto|EnrollUser/);
  });

  it('PUSH 2.0 firmware (no pushver) gets the legacy cursors and bitmask, attendance only', () => {
    expect(admsIsLegacyFirmware({ SN: 'X', options: 'all' })).toBe(true);
    expect(admsIsLegacyFirmware({ SN: 'X', options: 'all', pushver: '2.4.1' })).toBe(false);
    const r = admsHandshakeResponse({
      serialNumber: 'CQU4233560067',
      attlogStamp: '42',
      delaySeconds: 30,
      transIntervalMinutes: 1,
      timezoneHours: 1,
      legacy: true,
    });
    expect(r).toContain('Stamp=42');
    expect(r).toContain('OpStamp=9999');
    expect(r).toContain('TransFlag=1000000000');
    expect(r).toContain('TimeZone=1');
    expect(r).not.toContain('ATTLOGStamp');
  });

  it('validates serial numbers and tables', () => {
    expect(normaliseSerial(' cqu4233560067 ')).toBe('CQU4233560067');
    expect(normaliseSerial('../../etc')).toBeNull();
    expect(admsTable('attlog')).toBe('ATTLOG');
    expect(admsTable('OPERLOG')).toBe('OPERLOG');
    expect(admsTable('x')).toBe('OTHER');
  });
});

describe('ZKTeco SDK probe (simulated terminal — not a substitute for the physical test)', () => {
  it('builds packets whose checksum validates', () => {
    const { payload, nextReplyId } = zkPacket(ZK.CMD_CONNECT, 0, 65534);
    expect(nextReplyId).toBe(0);
    const parsed = parseZkPayload(payload)!;
    expect(parsed.command).toBe(ZK.CMD_CONNECT);
    // Recompute with the pre-increment reply id, as the terminal does.
    const check = Buffer.from(payload);
    check.writeUInt16LE(0, 2);
    check.writeUInt16LE(65534, 6);
    expect(zkChecksum(check)).toBe(payload.readUInt16LE(2));
  });

  it('reports UNREACHABLE honestly when nothing answers', async () => {
    const r = await probeZkSdk({ host: '127.0.0.1', port: 1, timeoutMs: 300 });
    expect(r.conclusion).toBe('UNREACHABLE');
    expect(r.transport).toBeNull();
  });

  it('reads identity from a simulated terminal and disconnects', async () => {
    const seen: number[] = [];
    const server = net.createServer((sock) => {
      sock.on('data', (buf) => {
        const p = parseZkPayload(buf.subarray(8))!;
        seen.push(p.command);
        const reply = (cmd: number, data = Buffer.alloc(0)) =>
          sock.write(zkTcpFrame(zkPacket(cmd, 4242, p.replyId, data).payload));
        if (p.command === ZK.CMD_CONNECT) reply(ZK.CMD_ACK_OK);
        else if (p.command === ZK.CMD_OPTIONS_RRQ) {
          const name = p.data.toString('latin1').split('\0')[0];
          const values: Record<string, string> = { '~SerialNumber': 'CQU4233560067', '~DeviceName': 'SIMULATED' };
          reply(ZK.CMD_ACK_OK, Buffer.from(`${name}=${values[name] ?? ''}\0`, 'latin1'));
        } else if (p.command === ZK.CMD_GET_VERSION) reply(ZK.CMD_ACK_OK, Buffer.from('Ver 6.60 SIM\0'));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const r = await probeZkSdk({ host: '127.0.0.1', port, timeoutMs: 1000 });
      expect(r.conclusion).toBe('SDK_CONNECTED');
      expect(r.transport).toBe('TCP');
      expect(r.deviceInfo).toMatchObject({ serialNumber: 'CQU4233560067', deviceName: 'SIMULATED', firmware: 'Ver 6.60 SIM' });
      await new Promise((r) => setTimeout(r, 50));
      expect(seen).toContain(ZK.CMD_EXIT);
      expect(seen).not.toContain(1500); // CMD_PREPARE_DATA — no bulk download is ever requested
    } finally {
      server.close();
    }
  });
});

describe('providers', () => {
  const base = {
    id: 'd1',
    name: 'Entrée',
    serialNumber: 'CQU4233560067',
    ipAddress: null,
    port: null,
    commKey: null,
    lastSuccessfulSyncAt: null,
  };

  it('ADMS never claims a connection before the terminal has called in', async () => {
    const r = await providerFor('ZKTECO_ADMS').testConnection({ ...base, provider: 'ZKTECO_ADMS', lastConnectionAt: null });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('WAITING_FOR_DEVICE');
  });

  it('ADMS is online only with a recent real contact', async () => {
    const recent = await providerFor('ZKTECO_ADMS').testConnection({
      ...base,
      provider: 'ZKTECO_ADMS',
      lastConnectionAt: new Date(Date.now() - 20_000),
    });
    expect(recent.status).toBe('ONLINE');
    const stale = await providerFor('ZKTECO_ADMS').testConnection({
      ...base,
      provider: 'ZKTECO_ADMS',
      lastConnectionAt: new Date(Date.now() - 3_600_000),
    });
    expect(stale.status).toBe('OFFLINE');
  });

  it('TCP log download stays disabled until confirmed on the real terminal', async () => {
    await expect(
      providerFor('ZKTECO_TCP').getAttendanceLogs({ ...base, provider: 'ZKTECO_TCP', lastConnectionAt: null }, null),
    ).rejects.toThrow(/pas activé/);
  });
});
