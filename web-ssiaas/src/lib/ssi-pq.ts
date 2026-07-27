import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url || __filename);
const corePath = path.join(process.cwd(), "lib", "ssi_pq_core.node");

let coreModule: any = null;

function getCore() {
  if (!coreModule) {
    try {
      coreModule = require(corePath);
    } catch (err) {
      console.error(`[ssi-pq] Failed to load ssi_pq_core.node from ${corePath}:`, err);
      throw err;
    }
  }
  return coreModule;
}

export interface SsiPqCore {
  canonicalJson(jsonString: string): string;
  base64urlEncode(bytes: Buffer): string;
  base64urlDecode(str: string): Buffer;
  mldsaSign(profile: string, privateKey: string, message: Buffer, context: string): string;
  mldsaVerify(
    profile: string,
    publicKey: string,
    message: Buffer,
    context: string,
    signature: string
  ): boolean;
  didVerify(didDocument: object): boolean;
  didFingerprintMatchesKeys(didDocument: object): boolean;
  createDid(options: { mldsa?: string; mlkem?: string; createdAt?: string }): {
    did: string;
    fingerprint: string;
    didDocument: Record<string, unknown>;
    privateKeys: {
      mldsaPrivateKey: string;
      mlkemPrivateKey: string;
    };
  };
}

/**
 * Retorna a instância carregada do módulo nativo ssi_pq_core.node
 */
export function getSsiPqCore(): SsiPqCore {
  return getCore();
}

/**
 * Decodifica Multibase Base58BTC (prefixado por 'z') em Buffer de bytes brutos.
 */
export function decodeBase58Btc(str: string): Buffer {
  if (str[0] !== "z") throw new Error("Not base58btc multibase");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let d = BigInt(0);
  const strData = str.slice(1);

  for (let i = 0; i < strData.length; i++) {
    d = d * BigInt(58) + BigInt(alphabet.indexOf(strData[i]));
  }

  let hex = d.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;

  const buf = Buffer.from(hex, "hex");
  let leadingZeros = 0;
  while (strData[leadingZeros] === "1") leadingZeros++;

  return Buffer.concat([Buffer.alloc(leadingZeros), buf]);
}

/**
 * Normaliza uma chave pública (Multibase Base58BTC ou Base64URL) para Base64URL
 * compatível com mldsaVerify (esperando 1952 bytes para ML-DSA-65).
 */
export function normalizeMldsaPublicKey(publicKeyStr: string): string {
  const core = getSsiPqCore();
  if (publicKeyStr.startsWith("z")) {
    const rawBytes = decodeBase58Btc(publicKeyStr);
    const pubKeyBytes =
      rawBytes.length > 1952 ? rawBytes.subarray(rawBytes.length - 1952) : rawBytes;
    return core.base64urlEncode(pubKeyBytes);
  }
  return publicKeyStr;
}

/**
 * Converte um objeto JSON para sua representação canônica (chaves ordenadas deterministicamente)
 */
export function canonicalizeJson(data: object): string {
  const core = getSsiPqCore();
  return core.canonicalJson(JSON.stringify(data));
}

/**
 * Valida a integridade e coerência criptográfica de um DID Document
 */
export function verifyDidDocument(didDocument: Record<string, unknown>): boolean {
  const core = getSsiPqCore();
  const isValid = core.didVerify(didDocument);
  if (!isValid) return false;
  return core.didFingerprintMatchesKeys(didDocument);
}

/**
 * Verifica a assinatura ML-DSA de um desafio de pareamento
 */
export function verifyPairingChallengeProof(params: {
  challengeData: Record<string, unknown>;
  signature: string;
  publicKey: string;
  profile?: string;
  context?: string;
}): boolean {
  const core = getSsiPqCore();
  const profile = params.profile || "ML-DSA-65";
  const context = params.context || "did-pairing-challenge";

  const normalizedPubKey = normalizeMldsaPublicKey(params.publicKey);

  const canonicalStr = core.canonicalJson(JSON.stringify(params.challengeData));
  const messageBuffer = Buffer.from(canonicalStr, "utf-8");

  return core.mldsaVerify(
    profile,
    normalizedPubKey,
    messageBuffer,
    context,
    params.signature
  );
}
