import { expect, test } from "vitest";
import { captchaGlyphs, captchaSvg } from "@/server/login-captcha";

test("B 字形为连续笔画，不能拆成可误读的 P 和 D", () => {
	expect(captchaGlyphs.B.match(/M/g)).toHaveLength(1);
});

test("验证码固定渲染五个字母笔画，且与字形定义一致", () => {
	const svg = captchaSvg("ABCDE");
	const paths = [...svg.matchAll(/<path d="([^"]+)" transform=/g)].map((match) => match[1]);
	expect(paths).toHaveLength(5);
	expect(paths).toEqual(["A", "B", "C", "D", "E"].map((letter) => captchaGlyphs[letter]));
});
