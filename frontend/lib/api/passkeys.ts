import { api } from "./client";
import type { PasskeyCredential } from "@/utils/types";

export type { PasskeyCredential };

export async function fetchPasskeyRegistrationOptions(publicKey: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    "/api/webauthn/register/begin",
    {},
  );
  return data.data;
}

export async function verifyPasskeyRegistration(credential: any, name: string) {
  const { data } = await api.post<{ success: boolean; message: string }>(
    "/api/webauthn/register/finish",
    { credential, name },
  );
  return data;
}

export async function fetchPasskeyLoginOptions(publicKey: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    "/api/webauthn/login/begin",
    { publicKey },
  );
  return data.data;
}

export async function verifyPasskeyLogin(credential: any, publicKey: string) {
  const { data } = await api.post<{ success: boolean; token: string }>(
    "/api/webauthn/login/finish",
    { credential, publicKey },
  );
  return data;
}

export async function fetchPasskeyCredentials(): Promise<PasskeyCredential[]> {
  const { data } = await api.get<{
    success: boolean;
    data: PasskeyCredential[];
  }>("/api/webauthn/credentials");
  return data.data;
}

export async function deletePasskeyCredential(id: string) {
  await api.delete(`/api/webauthn/credentials/${id}`);
}
