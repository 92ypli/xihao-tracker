import { webcrypto as crypto } from "node:crypto";

/**
 * 页面与归档的加密。
 *
 * 算法：PBKDF2-SHA256 派生密钥（25 万次迭代）→ AES-256-GCM。
 * 输出是 base64，内容布局：salt(16) + iv(12) + ciphertext。
 *
 * 浏览器端在 web/index.html 里用完全相同的参数解密（WebCrypto）。
 * 两边参数必须一致，改这里就要同步改那边。
 */

export const PBKDF2_ITER = 250000;
export const SALT_LEN = 16;
export const IV_LEN = 12;

async function deriveKeyFor(password, salt, usage) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

const deriveKey = (password, salt) => deriveKeyFor(password, salt, "encrypt");

/** base64 密文 → 原文 */
export async function decryptText(b64, password) {
  const buf = Buffer.from(String(b64).trim(), "base64");
  const salt = new Uint8Array(buf.subarray(0, SALT_LEN));
  const iv = new Uint8Array(buf.subarray(SALT_LEN, SALT_LEN + IV_LEN));
  const ct = new Uint8Array(buf.subarray(SALT_LEN + IV_LEN));
  const key = await deriveKeyFor(password, salt, "decrypt");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function decryptJson(b64, password) {
  return JSON.parse(await decryptText(b64, password));
}

/** 任意字符串 → base64 密文 */
export async function encryptText(text, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));

  const out = new Uint8Array(SALT_LEN + IV_LEN + ct.byteLength);
  out.set(salt, 0);
  out.set(iv, SALT_LEN);
  out.set(new Uint8Array(ct), SALT_LEN + IV_LEN);
  return Buffer.from(out).toString("base64");
}

export function encryptJson(obj, password) {
  return encryptText(JSON.stringify(obj), password);
}

/** 生成页面里的 payload：有密码就加密，没有就明文（本地预览用） */
export async function buildPayload(snap, password) {
  if (!password) {
    return { enc: false, plain: snap };
  }
  return {
    enc: true,
    iter: PBKDF2_ITER,
    saltLen: SALT_LEN,
    ivLen: IV_LEN,
    data: await encryptJson(snap, password),
  };
}
