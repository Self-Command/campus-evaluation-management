import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { consumeLimit } from "@/server/rate-limit";

// A basic image challenge. The letters are drawn as vector strokes so the answer
// never appears as plain text in the response payload. Glyphs use a 20x23 box and
// are scaled up with generous spacing, because earlier tightly packed and heavily
// rotated glyphs with seven noise lines could be read as additional letters.
// B is one continuous subpath: a detached lower bowl read as an extra D.
export const captchaGlyphs: Record<string, string> = {
  A: "M1 22 8 1 15 22 M4 15H12", B: "M2 22V1H8Q16 1 15 6Q14 11 8 11Q18 11 17 17Q16 22 8 22H2",
  C: "M15 3Q1 -3 1 11Q1 26 15 20", D: "M2 22V1H7Q17 1 16 12Q16 22 7 22Z",
  E: "M15 1H2V22H15 M2 11H12", F: "M15 1H2V22 M2 11H12",
  G: "M15 3Q1 -3 1 11Q1 26 16 20V12H9", H: "M2 1V22 M15 1V22 M2 11H15",
  K: "M2 1V22 M15 1 2 13 M7 9 16 22",
  M: "M1 22V1L9 13 17 1V22", N: "M2 22V1L15 22V1",
  P: "M2 22V1H9Q19 1 15 10Q14 12 2 12", R: "M2 22V1H9Q19 1 15 10Q14 12 2 12 M9 12 16 22",
  S: "M15 3Q2 -3 2 7Q2 11 9 12Q18 13 15 19Q11 25 1 20",
  T: "M1 1H17 M9 1V22", U: "M2 1V16Q2 27 15 20V1",
  V: "M1 1 8 22 16 1", W: "M1 1 5 22 10 10 15 22 19 1",
  X: "M1 1 16 22 M16 1 1 22", Y: "M1 1 9 12 17 1 M9 12V22",
  Z: "M1 1H16L1 22H16",
};
const alphabet = Object.keys(captchaGlyphs);
const width = 208, height = 64, scale = 1.7, spacing = 36, startX = 18, startY = 15;

export function captchaSvg(answer: string) {
  const lines = Array.from({ length: 3 }, () => `<path d="M${randomInt(width)} ${randomInt(height)}L${randomInt(width)} ${randomInt(height)}" stroke="#d4d4d8" stroke-width="1"/>`).join("");
  const letters = [...answer].map((letter, index) => `<path d="${captchaGlyphs[letter]}" transform="translate(${startX + index * spacing} ${startY + randomInt(-2, 3)}) scale(${scale}) rotate(${randomInt(-7, 8)} 9 12)" fill="none" stroke="#18181b" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="图片验证码"><rect width="${width}" height="${height}" rx="8" fill="#fafafa"/>${lines}${letters}</svg>`;
}

export function captchaAnswerHash(id: string, answer: string) {
  return createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(`login-captcha:${id}:${answer.trim().toUpperCase()}`).digest("hex");
}

export async function issueLoginCaptcha() {
  if (!(await consumeLimit("captcha-global", "local", 2000))) return null;
  const id = randomUUID();
  const answer = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  if (randomInt(32) === 0) await db.loginCaptcha.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.loginCaptcha.create({ data: { id, answerHash: captchaAnswerHash(id, answer), expiresAt } });
  const svg = captchaSvg(answer);
  return { id, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, expiresAt: expiresAt.toISOString() };
}

export async function consumeLoginCaptcha(id: string, answer: string) {
  const challenge = await db.loginCaptcha.findUnique({ where: { id } });
  if (!challenge) return false;
  // Only one racing request can delete the challenge. Wrong answers also consume it.
  const consumed = await db.loginCaptcha.deleteMany({ where: { id } });
  if (consumed.count !== 1 || challenge.expiresAt <= new Date()) return false;
  const expected = Buffer.from(challenge.answerHash, "hex"), actual = Buffer.from(captchaAnswerHash(id, answer), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
