import { requireDbConfig, type DbConfig, type Env } from '../config/env';
import { getLogger } from '../logger';
import { closePool, getPool, runQuery } from './connection';

export interface ReadOnlyAssessment {
  /** true si no se detecta ningun permiso de escritura; null si no se pudo determinar. */
  isReadOnly: boolean | null;
  canInsert: boolean | null;
  canUpdate: boolean | null;
  canDelete: boolean | null;
  isDbOwner: boolean | null;
  isDataWriter: boolean | null;
  details: string | null;
}

export interface ConnectionHealth {
  server: string;
  port: number;
  database: string;
  user: string;
  connected: boolean;
  latencyMs: number | null;
  serverName: string | null;
  loginName: string | null;
  productVersion: string | null;
  productLevel: string | null;
  edition: string | null;
  fullVersion: string | null;
  readOnly: ReadOnlyAssessment;
  error: string | null;
}

interface VersionRow {
  serverName: string | null;
  loginName: string | null;
  productVersion: string | null;
  productLevel: string | null;
  edition: string | null;
  fullVersion: string | null;
  databaseName: string | null;
}

interface PermissionsRow {
  canInsert: number | null;
  canUpdate: number | null;
  canDelete: number | null;
  isDbOwner: number | null;
  isDataWriter: number | null;
}

const VERSION_QUERY = `
SELECT
  CAST(SERVERPROPERTY('ServerName') AS nvarchar(256)) AS serverName,
  SUSER_SNAME() AS loginName,
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
  CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS productLevel,
  CAST(SERVERPROPERTY('Edition') AS nvarchar(256)) AS edition,
  @@VERSION AS fullVersion,
  DB_NAME() AS databaseName
`;

const PERMISSIONS_QUERY = `
SELECT
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS canInsert,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS canUpdate,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS canDelete,
  IS_MEMBER('db_owner') AS isDbOwner,
  IS_MEMBER('db_datawriter') AS isDataWriter
`;

const toBool = (value: number | null | undefined): boolean | null => {
  if (value === null || value === undefined) return null;
  return value === 1;
};

const assessReadOnly = (row: PermissionsRow | undefined): ReadOnlyAssessment => {
  if (!row) {
    return {
      isReadOnly: null,
      canInsert: null,
      canUpdate: null,
      canDelete: null,
      isDbOwner: null,
      isDataWriter: null,
      details: 'No se pudieron verificar permisos (el login puede no tener visibilidad).',
    };
  }
  const canInsert = toBool(row.canInsert);
  const canUpdate = toBool(row.canUpdate);
  const canDelete = toBool(row.canDelete);
  const isDbOwner = toBool(row.isDbOwner);
  const isDataWriter = toBool(row.isDataWriter);
  const writes =
    canInsert === true ||
    canUpdate === true ||
    canDelete === true ||
    isDbOwner === true ||
    isDataWriter === true;
  const isReadOnly =
    canInsert === null && canUpdate === null && canDelete === null ? null : !writes;
  return {
    isReadOnly,
    canInsert,
    canUpdate,
    canDelete,
    isDbOwner,
    isDataWriter,
    details:
      isReadOnly === true
        ? 'Sin permisos de escritura detectados en la base.'
        : isReadOnly === false
          ? 'ATENCION: el login tiene permisos de escritura. Se recomienda un usuario READ ONLY.'
          : 'No se pudo determinar con certeza.',
  };
};

/** Prueba de conexion + diagnostico READ ONLY. `closeAfter=false` mantiene el pool. */
export async function checkConnection(
  env?: Env,
  cfg?: DbConfig,
  closeAfter = true,
): Promise<ConnectionHealth> {
  const effective = cfg ?? requireDbConfig(env);
  const logger = getLogger();
  const empty: ConnectionHealth = {
    server: effective.server,
    port: effective.port,
    database: effective.database,
    user: effective.user,
    connected: false,
    latencyMs: null,
    serverName: null,
    loginName: null,
    productVersion: null,
    productLevel: null,
    edition: null,
    fullVersion: null,
    readOnly: assessReadOnly(undefined),
    error: null,
  };

  try {
    const start = Date.now();
    await getPool(effective);
    const latencyMs = Date.now() - start;

    let versionRow: VersionRow | undefined;
    let permRow: PermissionsRow | undefined;
    try {
      const result = await runQuery<VersionRow>(VERSION_QUERY);
      versionRow = result.rows[0];
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'No se pudo leer la version de SQL Server');
    }
    try {
      const result = await runQuery<PermissionsRow>(PERMISSIONS_QUERY);
      permRow = result.rows[0];
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'No se pudieron verificar permisos READ ONLY');
    }

    return {
      ...empty,
      connected: true,
      latencyMs,
      serverName: versionRow?.serverName ?? null,
      loginName: versionRow?.loginName ?? null,
      productVersion: versionRow?.productVersion ?? null,
      productLevel: versionRow?.productLevel ?? null,
      edition: versionRow?.edition ?? null,
      fullVersion: versionRow?.fullVersion ?? null,
      readOnly: assessReadOnly(permRow),
    };
  } catch (err) {
    return { ...empty, connected: false, error: (err as Error).message };
  } finally {
    // En un CLI de diagnostico cerramos el pool para que el proceso pueda salir.
    if (closeAfter) await closePool();
  }
}
