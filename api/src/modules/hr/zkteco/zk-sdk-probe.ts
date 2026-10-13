import * as dgram from 'dgram';
import * as net from 'net';

/**
 * Read-only diagnostic for the ZKTeco "standalone SDK" protocol (default port 4370).
 * It only connects, optionally authenticates with the comm key, reads identity options
 * (serial, name, platform, firmware) and disconnects. It never reads users, templates
 * or attendance logs and never writes to the terminal.
 */

export const ZK = {
  CMD_CONNECT: 1000,
  CMD_EXIT: 1001,
  CMD_AUTH: 1102,
  CMD_OPTIONS_RRQ: 11,
  CMD_GET_VERSION: 1100,
  CMD_ACK_OK: 2000,
  CMD_ACK_ERROR: 2001,
  CMD_ACK_DATA: 2002,
  CMD_ACK_UNAUTH: 2005,
} as const;

const USHRT_MAX = 65535;
const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

export function zkChecksum(buf: Buffer): number {
  let sum = 0;
  let i = 0;
  for (; i + 1 < buf.length; i += 2) {
    sum += buf.readUInt16LE(i);
    if (sum > USHRT_MAX) sum -= USHRT_MAX;
  }
  if (i < buf.length) sum += buf[buf.length - 1];
  while (sum > USHRT_MAX) sum -= USHRT_MAX;
  let c = ~sum;
  while (c < 0) c += USHRT_MAX;
  return c & 0xffff;
}

/** Builds one protocol payload. Returns the reply id the next packet must use. */
export function zkPacket(command: number, sessionId: number, replyId: number, data: Buffer = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt16LE(command, 0);
  head.writeUInt16LE(0, 2);
  head.writeUInt16LE(sessionId, 4);
  head.writeUInt16LE(replyId, 6);
  const checksum = zkChecksum(Buffer.concat([head, data]));
  let next = replyId + 1;
  if (next >= USHRT_MAX) next -= USHRT_MAX;
  head.writeUInt16LE(checksum, 2);
  head.writeUInt16LE(next, 6);
  return { payload: Buffer.concat([head, data]), nextReplyId: next };
}

export function zkTcpFrame(payload: Buffer): Buffer {
  const top = Buffer.alloc(8);
  TCP_MAGIC.copy(top, 0);
  top.writeUInt32LE(payload.length, 4);
  return Buffer.concat([top, payload]);
}

export type ZkReply = { command: number; sessionId: number; replyId: number; data: Buffer };

export function parseZkPayload(payload: Buffer): ZkReply | null {
  if (payload.length < 8) return null;
  return {
    command: payload.readUInt16LE(0),
    sessionId: payload.readUInt16LE(4),
    replyId: payload.readUInt16LE(6),
    data: payload.subarray(8),
  };
}

/** Comm-key challenge (same derivation as the vendor SDK). */
export function zkCommKey(key: number, sessionId: number, ticks = 50): Buffer {
  let k = 0;
  for (let i = 0; i < 32; i++) {
    k = (key & (1 << i)) !== 0 ? ((k << 1) | 1) >>> 0 : (k << 1) >>> 0;
  }
  k = (k + sessionId) >>> 0;
  const b = Buffer.alloc(4);
  b.writeUInt32LE(k, 0);
  const x = Buffer.from([b[0] ^ 0x5a, b[1] ^ 0x4b, b[2] ^ 0x53, b[3] ^ 0x4f]);
  const swapped = Buffer.alloc(4);
  swapped.writeUInt16LE(x.readUInt16LE(2), 0);
  swapped.writeUInt16LE(x.readUInt16LE(0), 2);
  const t = ticks & 0xff;
  return Buffer.from([swapped[0] ^ t, swapped[1] ^ t, t, swapped[3] ^ t]);
}

export type ProbeStep = { step: string; ok: boolean; detail: string; ms: number };

export type ProbeResult = {
  at: string;
  host: string;
  port: number;
  transport: 'TCP' | 'UDP' | null;
  conclusion:
    | 'SDK_CONNECTED'
    | 'SDK_AUTH_REQUIRED'
    | 'SDK_AUTH_FAILED'
    | 'PORT_OPEN_NO_ZK_REPLY'
    | 'UNREACHABLE';
  steps: ProbeStep[];
  deviceInfo: {
    serialNumber?: string;
    deviceName?: string;
    platform?: string;
    firmware?: string;
    mac?: string;
  };
};

interface Channel {
  send(payload: Buffer): void;
  receive(timeoutMs: number): Promise<ZkReply>;
  close(): void;
}

function tcpChannel(host: string, port: number, timeoutMs: number): Promise<Channel> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    const waiters: Array<(r: ZkReply) => void> = [];
    const queue: ZkReply[] = [];
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`TCP ${host}:${port} — délai dépassé (${timeoutMs} ms)`));
    }, timeoutMs);
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        if (!buffer.subarray(0, 4).equals(TCP_MAGIC)) {
          buffer = Buffer.alloc(0);
          return;
        }
        const len = buffer.readUInt32LE(4);
        if (buffer.length < 8 + len) return;
        const reply = parseZkPayload(buffer.subarray(8, 8 + len));
        buffer = buffer.subarray(8 + len);
        if (!reply) continue;
        const w = waiters.shift();
        if (w) w(reply);
        else queue.push(reply);
      }
    });
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.on('error', () => undefined);
      resolve({
        send: (payload) => sock.write(zkTcpFrame(payload)),
        receive: (ms) =>
          new Promise<ZkReply>((res, rej) => {
            const queued = queue.shift();
            if (queued) return res(queued);
            const t = setTimeout(() => {
              const i = waiters.indexOf(done);
              if (i >= 0) waiters.splice(i, 1);
              rej(new Error(`aucune réponse en ${ms} ms`));
            }, ms);
            const done = (r: ZkReply) => {
              clearTimeout(t);
              res(r);
            };
            waiters.push(done);
          }),
        close: () => sock.destroy(),
      });
    });
  });
}

function udpChannel(host: string, port: number): Channel {
  const sock = dgram.createSocket('udp4');
  const queue: ZkReply[] = [];
  const waiters: Array<(r: ZkReply) => void> = [];
  sock.on('error', () => undefined);
  sock.on('message', (msg) => {
    const reply = parseZkPayload(msg);
    if (!reply) return;
    const w = waiters.shift();
    if (w) w(reply);
    else queue.push(reply);
  });
  return {
    send: (payload) => sock.send(payload, port, host),
    receive: (ms) =>
      new Promise<ZkReply>((res, rej) => {
        const queued = queue.shift();
        if (queued) return res(queued);
        const t = setTimeout(() => {
          const i = waiters.indexOf(done);
          if (i >= 0) waiters.splice(i, 1);
          rej(new Error(`aucune réponse UDP en ${ms} ms`));
        }, ms);
        const done = (r: ZkReply) => {
          clearTimeout(t);
          res(r);
        };
        waiters.push(done);
      }),
    close: () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function optionValue(data: Buffer): string | null {
  const s = data.toString('latin1').split('\0')[0];
  const eq = s.indexOf('=');
  if (eq < 0) return null;
  const v = s.slice(eq + 1).trim();
  return v || null;
}

async function converse(
  ch: Channel,
  transport: 'TCP' | 'UDP',
  commKey: number,
  timeoutMs: number,
  result: ProbeResult,
): Promise<boolean> {
  const t0 = Date.now();
  let replyId = USHRT_MAX - 1;
  let session = 0;
  const call = async (cmd: number, data?: Buffer) => {
    const p = zkPacket(cmd, session, replyId, data);
    replyId = p.nextReplyId;
    ch.send(p.payload);
    return ch.receive(timeoutMs);
  };

  let hello: ZkReply;
  try {
    hello = await call(ZK.CMD_CONNECT);
  } catch (e) {
    result.steps.push({
      step: `${transport} CMD_CONNECT`,
      ok: false,
      detail: (e as Error).message,
      ms: Date.now() - t0,
    });
    return false;
  }
  session = hello.sessionId;
  result.transport = transport;
  if (hello.command === ZK.CMD_ACK_UNAUTH) {
    result.steps.push({
      step: `${transport} CMD_CONNECT`,
      ok: true,
      detail: `Le terminal a répondu et exige une clé de communication (session ${session})`,
      ms: Date.now() - t0,
    });
    const auth = await call(ZK.CMD_AUTH, zkCommKey(commKey, session)).catch((e: Error) => e);
    if (auth instanceof Error || auth.command !== ZK.CMD_ACK_OK) {
      result.conclusion = commKey ? 'SDK_AUTH_FAILED' : 'SDK_AUTH_REQUIRED';
      result.steps.push({
        step: `${transport} CMD_AUTH`,
        ok: false,
        detail:
          auth instanceof Error
            ? auth.message
            : `Clé refusée (code ${auth.command}). Vérifier Menu → Comm. → Clé de communication.`,
        ms: Date.now() - t0,
      });
      return true;
    }
    result.steps.push({ step: `${transport} CMD_AUTH`, ok: true, detail: 'Clé acceptée', ms: Date.now() - t0 });
  } else if (hello.command !== ZK.CMD_ACK_OK) {
    result.steps.push({
      step: `${transport} CMD_CONNECT`,
      ok: false,
      detail: `Réponse inattendue (code ${hello.command}) — protocole non confirmé`,
      ms: Date.now() - t0,
    });
    result.conclusion = 'PORT_OPEN_NO_ZK_REPLY';
    return true;
  } else {
    result.steps.push({
      step: `${transport} CMD_CONNECT`,
      ok: true,
      detail: `Protocole SDK ZKTeco confirmé (session ${session})`,
      ms: Date.now() - t0,
    });
  }

  result.conclusion = 'SDK_CONNECTED';
  const options: Array<[keyof ProbeResult['deviceInfo'], string]> = [
    ['serialNumber', '~SerialNumber'],
    ['deviceName', '~DeviceName'],
    ['platform', '~Platform'],
    ['mac', 'MAC'],
  ];
  for (const [key, name] of options) {
    try {
      const r = await call(ZK.CMD_OPTIONS_RRQ, Buffer.from(`${name}\0`, 'latin1'));
      const v = r.command === ZK.CMD_ACK_OK ? optionValue(r.data) : null;
      if (v) result.deviceInfo[key] = v;
      result.steps.push({ step: `Lecture ${name}`, ok: !!v, detail: v ?? `non disponible (code ${r.command})`, ms: Date.now() - t0 });
    } catch (e) {
      result.steps.push({ step: `Lecture ${name}`, ok: false, detail: (e as Error).message, ms: Date.now() - t0 });
    }
  }
  try {
    const r = await call(ZK.CMD_GET_VERSION);
    const v = r.command === ZK.CMD_ACK_OK ? r.data.toString('latin1').split('\0')[0].trim() : '';
    if (v) result.deviceInfo.firmware = v;
    result.steps.push({ step: 'Version firmware', ok: !!v, detail: v || `non disponible (code ${r.command})`, ms: Date.now() - t0 });
  } catch (e) {
    result.steps.push({ step: 'Version firmware', ok: false, detail: (e as Error).message, ms: Date.now() - t0 });
  }
  try {
    const p = zkPacket(ZK.CMD_EXIT, session, replyId);
    ch.send(p.payload);
  } catch {
    /* best effort */
  }
  return true;
}

export async function probeZkSdk(opts: {
  host: string;
  port?: number;
  commKey?: number;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const port = opts.port ?? 4370;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const commKey = opts.commKey ?? 0;
  const result: ProbeResult = {
    at: new Date().toISOString(),
    host: opts.host,
    port,
    transport: null,
    conclusion: 'UNREACHABLE',
    steps: [],
    deviceInfo: {},
  };

  const t0 = Date.now();
  let tcp: Channel | null = null;
  try {
    tcp = await tcpChannel(opts.host, port, timeoutMs);
    result.steps.push({ step: `Port TCP ${port}`, ok: true, detail: 'ouvert', ms: Date.now() - t0 });
  } catch (e) {
    result.steps.push({ step: `Port TCP ${port}`, ok: false, detail: (e as Error).message, ms: Date.now() - t0 });
  }
  if (tcp) {
    try {
      const answered = await converse(tcp, 'TCP', commKey, timeoutMs, result);
      if (answered) return result;
      result.conclusion = 'PORT_OPEN_NO_ZK_REPLY';
    } finally {
      tcp.close();
    }
  }

  const udp = udpChannel(opts.host, port);
  try {
    const answered = await converse(udp, 'UDP', commKey, timeoutMs, result);
    if (!answered && result.conclusion !== 'PORT_OPEN_NO_ZK_REPLY') result.conclusion = 'UNREACHABLE';
  } finally {
    udp.close();
  }
  return result;
}
