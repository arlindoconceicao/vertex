import { PinataSDK } from "pinata";

// As variáveis JWT_PINATA e GATEWAY_PINATA devem estar definidas no .env
const jwt = process.env.JWT_PINATA;
const gateway = process.env.GATEWAY_PINATA;

if (typeof window !== "undefined") {
  throw new Error("O cliente do Pinata não deve ser instanciado no frontend.");
}

export const pinata = new PinataSDK({
  pinataJwt: jwt || "",
  pinataGateway: gateway || "",
});
