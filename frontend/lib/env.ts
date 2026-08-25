export function requireClientEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback?.trim() || "";
  if (!value) {
    throw new Error(`${name} is not set. Add it to your .env.local file.`);
  }
  return value;
}

export function optionalClientEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}
