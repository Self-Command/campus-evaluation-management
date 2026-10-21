import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sameOrigin } from "@/server/http";

const initialUrl = process.env.NEXTAUTH_URL;
const initialTrusted = process.env.APP_TRUSTED_ORIGINS;

function post(url: string, origin?: string) {
  return new Request(url, {
    method: "POST",
    headers: origin === undefined ? undefined : { origin },
  });
}

describe("业务写入来源校验", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    delete process.env.APP_TRUSTED_ORIGINS;
  });

  afterAll(() => {
    if (initialUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = initialUrl;
    if (initialTrusted === undefined) delete process.env.APP_TRUSTED_ORIGINS;
    else process.env.APP_TRUSTED_ORIGINS = initialTrusted;
  });

  test("接受配置来源、请求同源和本机回环别名", () => {
    expect(
      sameOrigin(
        post("http://localhost:3000/api/terms", "http://localhost:3000"),
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        post("http://127.0.0.1:3000/api/terms", "http://127.0.0.1:3000"),
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        post("http://127.0.0.1:3000/api/terms", "http://localhost:3000"),
      ),
    ).toBe(true);
  });

  test("接受显式配置的额外部署来源", () => {
    process.env.NEXTAUTH_URL = "https://evaluation.example.edu.cn";
    process.env.APP_TRUSTED_ORIGINS =
      "https://backup.example.edu.cn, https://evaluation2.example.edu.cn";
    expect(
      sameOrigin(
        post("http://10.0.0.5:3000/api/terms", "https://backup.example.edu.cn"),
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        post(
          "http://10.0.0.5:3000/api/terms",
          "https://evaluation2.example.edu.cn",
        ),
      ),
    ).toBe(true);
  });

  test("拒绝跨站、端口不一致、缺失和非法来源", () => {
    expect(
      sameOrigin(post("http://localhost:3000/api/terms", "https://evil.example")),
    ).toBe(false);
    expect(
      sameOrigin(
        post("http://localhost:3000/api/terms", "http://127.0.0.1:3001"),
      ),
    ).toBe(false);
    expect(sameOrigin(post("http://localhost:3000/api/terms"))).toBe(false);
    expect(
      sameOrigin(post("http://localhost:3000/api/terms", "null")),
    ).toBe(false);
    expect(
      sameOrigin(
        post("http://localhost:3000/api/terms", "http://localhost:3000/path"),
      ),
    ).toBe(false);
    expect(
      sameOrigin(post("http://localhost:3000/api/terms", "file:///tmp/evil")),
    ).toBe(false);
  });
});
