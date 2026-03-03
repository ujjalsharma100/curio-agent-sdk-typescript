import { CredentialError } from "../models/errors.js";

export interface CredentialResolveOptions {
  /** Optional field for structured secrets (e.g. JSON object). */
  field?: string;
  /** Throw when not found if true. */
  required?: boolean;
}

export interface CredentialResolver {
  resolve(name: string, options?: CredentialResolveOptions): Promise<string | undefined>;
}

export interface EnvCredentialResolverOptions {
  env?: NodeJS.ProcessEnv;
  prefix?: string;
}

/**
 * Resolve credentials from environment variables.
 */
export class EnvCredentialResolver implements CredentialResolver {
  private readonly env: NodeJS.ProcessEnv;
  private readonly prefix: string;

  constructor(options: EnvCredentialResolverOptions = {}) {
    this.env = options.env ?? process.env;
    this.prefix = options.prefix ?? "";
  }

  async resolve(name: string, options: CredentialResolveOptions = {}): Promise<string | undefined> {
    const keys = this.getCandidateKeys(name);
    for (const key of keys) {
      const value = this.env[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    if (options.required) {
      throw new CredentialError(`Credential "${name}" not found in environment`);
    }
    return undefined;
  }

  private getCandidateKeys(name: string): string[] {
    const normalized = name.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
    if (!this.prefix) {
      return [name, normalized];
    }
    return [`${this.prefix}${name}`, `${this.prefix}${normalized}`, normalized];
  }
}

export interface VaultCredentialResolverOptions {
  address: string;
  token: string;
  mountPath?: string;
  kvVersion?: 1 | 2;
  namespace?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Resolve credentials from HashiCorp Vault over HTTP API.
 *
 * Optional integration: no external SDK required.
 */
export class VaultCredentialResolver implements CredentialResolver {
  private readonly address: string;
  private readonly token: string;
  private readonly mountPath: string;
  private readonly kvVersion: 1 | 2;
  private readonly namespace?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VaultCredentialResolverOptions) {
    this.address = options.address.replace(/\/+$/, "");
    this.token = options.token;
    this.mountPath = (options.mountPath ?? "secret").replace(/^\/+|\/+$/g, "");
    this.kvVersion = options.kvVersion ?? 2;
    this.namespace = options.namespace;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async resolve(name: string, options: CredentialResolveOptions = {}): Promise<string | undefined> {
    const { path, inlineField } = parseSecretRef(name);
    const field = options.field ?? inlineField;
    const value = await this.readVaultSecret(path, field);
    if (value === undefined && options.required) {
      throw new CredentialError(`Vault secret "${name}" was not found`);
    }
    return value;
  }

  private async readVaultSecret(path: string, field?: string): Promise<string | undefined> {
    const escapedPath = path.replace(/^\/+/, "");
    const endpoint =
      this.kvVersion === 2
        ? `${this.address}/v1/${this.mountPath}/data/${escapedPath}`
        : `${this.address}/v1/${this.mountPath}/${escapedPath}`;

    const headers: Record<string, string> = {
      "X-Vault-Token": this.token,
      Accept: "application/json",
    };
    if (this.namespace) {
      headers["X-Vault-Namespace"] = this.namespace;
    }

    const response = await this.fetchImpl(endpoint, { method: "GET", headers });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new CredentialError(`Vault request failed (${response.status}): ${bodyText || response.statusText}`);
    }

    const json = (await response.json()) as unknown;
    const secretObj = extractVaultData(json, this.kvVersion);
    if (!secretObj) {
      return undefined;
    }

    if (field) {
      const val = secretObj[field];
      return valueToString(val);
    }
    return getDefaultSecretValue(secretObj);
  }
}

export interface AWSSecretsResolverOptions {
  region?: string;
  endpoint?: string;
}

/**
 * Resolve credentials from AWS Secrets Manager.
 *
 * Optional integration: dynamically imports @aws-sdk/client-secrets-manager.
 */
export class AWSSecretsResolver implements CredentialResolver {
  private readonly region?: string;
  private readonly endpoint?: string;
  private client: {
    send(command: unknown): Promise<{
      SecretString?: string;
      SecretBinary?: Uint8Array;
    }>;
  } | null = null;
  private commandCtor: (input: { SecretId: string }) => unknown = () => ({});

  constructor(options: AWSSecretsResolverOptions = {}) {
    this.region = options.region;
    this.endpoint = options.endpoint;
  }

  async resolve(name: string, options: CredentialResolveOptions = {}): Promise<string | undefined> {
    await this.ensureClient();
    const { path: secretId, inlineField } = parseSecretRef(name);
    const field = options.field ?? inlineField;
    const command = this.commandCtor({ SecretId: secretId });
    const output = await this.client!.send(command);

    const secretString = this.extractSecretString(output);
    if (!secretString) {
      if (options.required) {
        throw new CredentialError(`AWS secret "${name}" was empty`);
      }
      return undefined;
    }

    const resolved = field ? extractFromJsonString(secretString, field) : secretString;
    if (resolved === undefined && options.required) {
      throw new CredentialError(`AWS secret "${name}" missing field "${field}"`);
    }
    return resolved;
  }

  private extractSecretString(output: { SecretString?: string; SecretBinary?: Uint8Array }): string | undefined {
    if (typeof output.SecretString === "string") {
      return output.SecretString;
    }
    if (output.SecretBinary) {
      return Buffer.from(output.SecretBinary).toString("utf8");
    }
    return undefined;
  }

  private async ensureClient(): Promise<void> {
    if (this.client) {
      return;
    }
    const awsModule = (await dynamicImport("@aws-sdk/client-secrets-manager").catch(() => null)) as
      | {
          SecretsManagerClient: new (config?: Record<string, unknown>) => {
            send(command: unknown): Promise<{
              SecretString?: string;
              SecretBinary?: Uint8Array;
            }>;
          };
          GetSecretValueCommand: new (input: { SecretId: string }) => unknown;
        }
      | null;
    if (!awsModule) {
      throw new CredentialError(
        "AWSSecretsResolver requires optional dependency \"@aws-sdk/client-secrets-manager\"",
      );
    }

    this.client = new awsModule.SecretsManagerClient({
      region: this.region,
      endpoint: this.endpoint,
    });
    this.commandCtor = (input) => new awsModule.GetSecretValueCommand(input);
  }
}

/**
 * Try a list of resolvers in order.
 */
export async function resolveCredentialChain(
  name: string,
  resolvers: CredentialResolver[],
  options: CredentialResolveOptions = {},
): Promise<string | undefined> {
  for (const resolver of resolvers) {
    const value = await resolver.resolve(name, { ...options, required: false });
    if (value !== undefined) {
      return value;
    }
  }
  if (options.required) {
    throw new CredentialError(`Credential "${name}" was not resolved by any resolver`);
  }
  return undefined;
}

export async function resolveCredentialOrThrow(
  name: string,
  resolvers: CredentialResolver[],
  options: Omit<CredentialResolveOptions, "required"> = {},
): Promise<string> {
  const value = await resolveCredentialChain(name, resolvers, {
    ...options,
    required: true,
  });
  if (value === undefined) {
    throw new CredentialError(`Credential "${name}" was not resolved`);
  }
  return value;
}

function parseSecretRef(name: string): { path: string; inlineField?: string } {
  const [path, inlineField] = name.split("#", 2);
  return { path: path ?? name, inlineField };
}

function extractVaultData(
  value: unknown,
  kvVersion: 1 | 2,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (kvVersion === 2) {
    const dataValue = value["data"];
    if (!isRecord(dataValue)) {
      return undefined;
    }
    const innerData = dataValue["data"];
    return isRecord(innerData) ? innerData : undefined;
  }

  const dataValue = value["data"];
  return isRecord(dataValue) ? dataValue : undefined;
}

function getDefaultSecretValue(secretObj: Record<string, unknown>): string | undefined {
  const preferredKeys = ["value", "secret", "token", "password", "api_key", "apiKey"];
  for (const key of preferredKeys) {
    if (key in secretObj) {
      const preferred = valueToString(secretObj[key]);
      if (preferred !== undefined) {
        return preferred;
      }
    }
  }
  if (Object.keys(secretObj).length === 1) {
    const onlyValue = valueToString(Object.values(secretObj)[0]);
    if (onlyValue !== undefined) {
      return onlyValue;
    }
  }
  return JSON.stringify(secretObj);
}

function extractFromJsonString(secretString: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (isRecord(parsed)) {
      return valueToString(parsed[field]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function valueToString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function dynamicImport(moduleName: string): Promise<unknown> {
  const fn = new Function("m", "return import(m);") as (moduleArg: string) => Promise<unknown>;
  return fn(moduleName);
}
