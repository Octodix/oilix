import type { ParsedPunch } from './attlog-parser';
import { probeZkSdk, type ProbeResult } from './zk-sdk-probe';

/**
 * Replaceable terminal integration. Oilix services only talk to this interface; a new
 * terminal brand or protocol is a new provider, not a change to attendance or payroll.
 */

export const PROVIDER_KINDS = ['ZKTECO_ADMS', 'ZKTECO_TCP', 'ZKTECO_FILE'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type ProviderDevice = {
  id: string;
  name: string;
  provider: string;
  serialNumber: string | null;
  ipAddress: string | null;
  port: number | null;
  commKey: string | null;
  lastConnectionAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
};

export type ConnectionTest = {
  ok: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'WAITING_FOR_DEVICE' | 'AUTH_REQUIRED' | 'NOT_APPLICABLE' | 'ERROR';
  message: string;
  deviceInfo?: Record<string, string>;
  diagnostic?: ProbeResult;
};

export type DeviceUserInfo = { deviceUserId: string; name: string | null };

export type ProviderCapabilities = {
  connectionTest: boolean;
  pullLogs: boolean;
  pushLogs: boolean;
  fileImport: boolean;
  listUsers: boolean;
};

export class ProviderNotSupportedError extends Error {}

export interface AttendanceDeviceProvider {
  readonly kind: ProviderKind;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  testConnection(device: ProviderDevice): Promise<ConnectionTest>;
  getDeviceInfo(device: ProviderDevice): Promise<Record<string, string> | null>;
  getUsers(device: ProviderDevice): Promise<DeviceUserInfo[]>;
  getAttendanceLogs(device: ProviderDevice, since: Date | null): Promise<ParsedPunch[]>;
}

/** Terminal considered online if it polled within this window (ADMS Delay is 30 s). */
export const ADMS_ONLINE_WINDOW_MS = 5 * 60_000;

class AdmsPushProvider implements AttendanceDeviceProvider {
  readonly kind = 'ZKTECO_ADMS' as const;
  readonly label = 'ZKTeco ADMS (push HTTP)';
  readonly capabilities = { connectionTest: true, pullLogs: false, pushLogs: true, fileImport: true, listUsers: false };

  async testConnection(device: ProviderDevice): Promise<ConnectionTest> {
    if (!device.serialNumber) {
      return {
        ok: false,
        status: 'ERROR',
        message: 'Numéro de série manquant : en mode ADMS le terminal est identifié uniquement par son SN.',
      };
    }
    const last = device.lastConnectionAt;
    if (!last) {
      return {
        ok: false,
        status: 'WAITING_FOR_DEVICE',
        message:
          "Le terminal n'a encore jamais contacté Oilix. En mode ADMS c'est le terminal qui appelle le serveur : " +
          "configurer sur le terminal Comm. → Cloud Server / ADMS avec l'adresse IP du serveur Oilix et le port de l'API.",
      };
    }
    const age = Date.now() - last.getTime();
    if (age <= ADMS_ONLINE_WINDOW_MS) {
      return { ok: true, status: 'ONLINE', message: `Dernier contact du terminal il y a ${Math.round(age / 1000)} s.` };
    }
    return {
      ok: false,
      status: 'OFFLINE',
      message: `Aucun contact depuis ${Math.round(age / 60_000)} min. Vérifier l'alimentation et le réseau du terminal.`,
    };
  }

  async getDeviceInfo(): Promise<Record<string, string> | null> {
    return null;
  }

  async getUsers(): Promise<DeviceUserInfo[]> {
    throw new ProviderNotSupportedError(
      "Le mode ADMS est configuré pour n'envoyer que les pointages : la liste des utilisateurs et les empreintes ne sont pas demandées au terminal.",
    );
  }

  async getAttendanceLogs(): Promise<ParsedPunch[]> {
    throw new ProviderNotSupportedError(
      'En mode ADMS les pointages sont envoyés automatiquement par le terminal ; Oilix ne peut pas les tirer à la demande.',
    );
  }
}

class TcpSdkProvider implements AttendanceDeviceProvider {
  readonly kind = 'ZKTECO_TCP' as const;
  readonly label = 'ZKTeco SDK TCP/UDP (port 4370)';
  readonly capabilities = { connectionTest: true, pullLogs: false, pushLogs: false, fileImport: true, listUsers: false };

  async testConnection(device: ProviderDevice): Promise<ConnectionTest> {
    if (!device.ipAddress) {
      return { ok: false, status: 'ERROR', message: 'Adresse IP du terminal manquante.' };
    }
    const diagnostic = await probeZkSdk({
      host: device.ipAddress,
      port: device.port ?? 4370,
      commKey: device.commKey ? Number(device.commKey) || 0 : 0,
    });
    const info = Object.fromEntries(
      Object.entries(diagnostic.deviceInfo).filter(([, v]) => typeof v === 'string' && v),
    ) as Record<string, string>;
    switch (diagnostic.conclusion) {
      case 'SDK_CONNECTED':
        return {
          ok: true,
          status: 'ONLINE',
          message: `Le terminal répond au protocole SDK ZKTeco (${diagnostic.transport}).`,
          deviceInfo: info,
          diagnostic,
        };
      case 'SDK_AUTH_REQUIRED':
      case 'SDK_AUTH_FAILED':
        return {
          ok: false,
          status: 'AUTH_REQUIRED',
          message: 'Le terminal répond mais refuse la clé de communication configurée.',
          diagnostic,
        };
      case 'PORT_OPEN_NO_ZK_REPLY':
        return {
          ok: false,
          status: 'ERROR',
          message: 'Le port répond mais pas avec le protocole ZKTeco attendu.',
          diagnostic,
        };
      default:
        return {
          ok: false,
          status: 'OFFLINE',
          message: `Aucune réponse de ${device.ipAddress}:${device.port ?? 4370} (TCP ni UDP).`,
          diagnostic,
        };
    }
  }

  async getDeviceInfo(device: ProviderDevice) {
    const t = await this.testConnection(device);
    return t.deviceInfo ?? null;
  }

  async getUsers(): Promise<DeviceUserInfo[]> {
    throw new ProviderNotSupportedError(
      "La lecture des utilisateurs via le SDK n'est pas activée : elle sera ajoutée seulement après validation sur le terminal réel.",
    );
  }

  async getAttendanceLogs(): Promise<ParsedPunch[]> {
    throw new ProviderNotSupportedError(
      "Le téléchargement des pointages via le SDK TCP n'est pas activé tant que la communication n'a pas été confirmée " +
        'sur le terminal réel. Utiliser le mode ADMS ou l’import de fichier (clé USB).',
    );
  }
}

class FileImportProvider implements AttendanceDeviceProvider {
  readonly kind = 'ZKTECO_FILE' as const;
  readonly label = 'Import de fichier (clé USB / export)';
  readonly capabilities = { connectionTest: false, pullLogs: false, pushLogs: false, fileImport: true, listUsers: false };

  async testConnection(): Promise<ConnectionTest> {
    return {
      ok: true,
      status: 'NOT_APPLICABLE',
      message: "Terminal sans liaison réseau : exporter les pointages sur clé USB puis importer le fichier dans Oilix.",
    };
  }

  async getDeviceInfo() {
    return null;
  }

  async getUsers(): Promise<DeviceUserInfo[]> {
    throw new ProviderNotSupportedError('Non disponible pour un terminal importé par fichier.');
  }

  async getAttendanceLogs(): Promise<ParsedPunch[]> {
    throw new ProviderNotSupportedError('Utiliser « Importer un fichier » pour ce terminal.');
  }
}

const PROVIDERS: Record<ProviderKind, AttendanceDeviceProvider> = {
  ZKTECO_ADMS: new AdmsPushProvider(),
  ZKTECO_TCP: new TcpSdkProvider(),
  ZKTECO_FILE: new FileImportProvider(),
};

export function isProviderKind(v: unknown): v is ProviderKind {
  return typeof v === 'string' && (PROVIDER_KINDS as readonly string[]).includes(v);
}

export function providerFor(kind: string): AttendanceDeviceProvider {
  if (!isProviderKind(kind)) throw new ProviderNotSupportedError(`Fournisseur inconnu : ${kind}`);
  return PROVIDERS[kind];
}

export function providerCatalog() {
  return PROVIDER_KINDS.map((k) => ({
    kind: k,
    label: PROVIDERS[k].label,
    capabilities: PROVIDERS[k].capabilities,
  }));
}
