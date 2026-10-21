import { issueLoginCaptcha } from "@/server/login-captcha";
import { apiError } from "@/server/http";

export async function GET() {
  try {
    const challenge = await issueLoginCaptcha();
    return Response.json(challenge ?? { error: "验证码请求过于频繁，请稍后重试" }, { status: challenge ? 200 : 429, headers: { "Cache-Control": "no-store", ...(challenge ? {} : { "Retry-After": "60" }) } });
  } catch (error) { return apiError(error); }
}
