import { api } from "./client";

export async function verifyPasskeyRegistration(credential: any, name: string) {
  const { data } = await api.post<{ success: boolean; message: string }>(
    "/api/webauthn/register-verify",
    { credential, name },
  );
  return data;
}

export async function fetchPasskeyLoginOptions(publicKey: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    "/api/webauthn/login-options",
    { publicKey },
  );
  return data.data;
}

export async function verifyPasskeyLogin(credential: any, publicKey: string) {
  const { data } = await api.post<{ success: boolean; token: string }>(
    "/api/webauthn/login-verify",
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
