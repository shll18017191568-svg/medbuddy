/** 读取环境变量中的 PEM 密钥：支持 \n 转义与无头尾的纯 base64 */
export function normalizePem(key: string, type: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const value = key.replace(/\\n/g, "\n").trim();
  if (value.includes("-----BEGIN")) return value;
  const body = value.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----`;
}

/** 读取必填环境变量，返回缺失项列表（不打印值，避免密钥泄漏） */
export function missingEnv(names: string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim());
}
