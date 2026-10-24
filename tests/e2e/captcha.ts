import { captchaGlyphs } from "../../src/server/login-captcha";

const pathToLetter = new Map(
	Object.entries(captchaGlyphs).map(([letter, path]) => [path, letter]),
);

export function solveCaptcha(dataUrl: string) {
	const svg = Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
	const paths = [...svg.matchAll(/<path d="([^"]+)" transform=/g)].map(
		(match) => match[1],
	);
	const answer = paths.map((path) => pathToLetter.get(path) || "").join("");
	if (answer.length !== 5) throw new Error("验证码解析失败");
	return answer;
}
