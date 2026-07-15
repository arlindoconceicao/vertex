import type {FileOperationResult, JsonInput, JsonObject} from './types';

export function jsonToString(value: JsonInput, fieldName = 'value'): string {
  if (typeof value === 'string') {
    assertJsonString(value, fieldName);
    return value;
  }

  return JSON.stringify(value);
}

export function optionalJsonToString(
  value: JsonInput | null | undefined,
  fieldName = 'value',
): string | null {
  if (value == null) {
    return null;
  }

  return jsonToString(value, fieldName);
}

export function parseJson<T>(value: string, fieldName = 'value'): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${errorMessage(error)}`);
  }
}

export function normalizeFileOperationResult(value: string): FileOperationResult {
  const parsed = parseJson<JsonObject>(value, 'file operation result');
  const outputUri = parsed.outputUri;
  const bytesWritten = parsed.bytesWritten;
  const metadataJson = parsed.metadataJson;

  if (typeof outputUri !== 'string') {
    throw new Error('file operation result outputUri must be a string');
  }
  if (typeof bytesWritten !== 'number') {
    throw new Error('file operation result bytesWritten must be a number');
  }
  if (metadataJson != null && typeof metadataJson !== 'string') {
    throw new Error('file operation result metadataJson must be a string or null');
  }

  return {outputUri, bytesWritten, metadataJson};
}

export function normalizeMobileError(error: unknown): {code: string; message: string; cause?: unknown} {
  if (error instanceof Error) {
    return {
      code: codeFromMessage(error.message),
      message: error.message,
      cause: error,
    };
  }

  return {
    code: 'Unknown',
    message: String(error),
    cause: error,
  };
}

function assertJsonString(value: string, fieldName: string): void {
  try {
    JSON.parse(value);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${errorMessage(error)}`);
  }
}

function codeFromMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid input')) return 'InvalidInput';
  if (lower.includes('cryptographic')) return 'Crypto';
  if (lower.includes('wallet')) return 'Wallet';
  if (lower.includes('pdf')) return 'Pdf';
  if (lower.includes('storage')) return 'Storage';
  if (lower.includes('file operation') || lower.includes('io')) return 'Io';
  if (lower.includes('unavailable')) return 'Unavailable';
  return 'Unknown';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
