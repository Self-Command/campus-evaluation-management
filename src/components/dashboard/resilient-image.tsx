"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const AUTO_RETRY_DELAYS = [1000, 3000];
const ATTEMPT_TIMEOUT = 15_000;
const HEAD_TIMEOUT = 8_000;
const LAZY_ROOT_MARGIN = "600px 0px";

type FailureKind = "auth" | "forbidden" | "missing" | "server" | "network" | "timeout" | "unknown";

const RETRYABLE: FailureKind[] = ["server", "network", "timeout", "unknown"];

const failureMessages: Record<FailureKind, string> = {
	auth: "登录状态已失效，请重新登录。",
	forbidden: "你没有查看这张图片的权限。",
	missing: "图片已被删除，或你没有查看权限。",
	server: "服务器暂时无法提供图片。",
	network: "网络连接中断，图片没有加载。",
	timeout: "网络较慢，图片加载超时。",
	unknown: "图片内容无法显示。",
};

function attemptUrl(url: string, attempt: number) {
	if (!attempt) return url;
	const [base, hash] = url.split("#", 2);
	return `${base}${base.includes("?") ? "&" : "?"}_retry=${attempt}${hash ? `#${hash}` : ""}`;
}

async function classifyFailure(url: string): Promise<FailureKind> {
	try {
		const response = await fetch(url, {
			method: "HEAD",
			cache: "no-store",
			signal: AbortSignal.timeout(HEAD_TIMEOUT),
		});
		if (response.status === 401) return "auth";
		if (response.status === 403) return "forbidden";
		if (response.status === 404) return "missing";
		if (response.status >= 500) return "server";
		return "unknown";
	} catch {
		return "network";
	}
}

export function ResilientImage({
	src,
	alt = "",
	priority = false,
	className,
}: {
	src?: string;
	alt?: string;
	priority?: boolean;
	className?: string;
}) {
	const router = useRouter();
	const [started, setStarted] = useState(priority);
	const [attempt, setAttempt] = useState(0);
	const [autoRetries, setAutoRetries] = useState(0);
	const [loaded, setLoaded] = useState(false);
	const [offline, setOffline] = useState(false);
	const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
	const [outcome, setOutcome] = useState<{
		kind: FailureKind;
		retrying: boolean;
	} | null>(null);
	const hostRef = useRef<HTMLSpanElement>(null);
	const imageRef = useRef<HTMLImageElement>(null);

	useEffect(() => {
		if (priority || started) return;
		const host = hostRef.current;
		if (!host) return;
		if (typeof IntersectionObserver === "undefined") {
			const timer = window.setTimeout(() => setStarted(true), 0);
			return () => window.clearTimeout(timer);
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setStarted(true);
					observer.disconnect();
				}
			},
			{ rootMargin: LAZY_ROOT_MARGIN },
		);
		observer.observe(host);
		return () => observer.disconnect();
	}, [priority, started]);

	useEffect(() => {
		const sync = () => setOffline(!navigator.onLine);
		sync();
		window.addEventListener("online", sync);
		window.addEventListener("offline", sync);
		return () => {
			window.removeEventListener("online", sync);
			window.removeEventListener("offline", sync);
		};
	}, []);

	useEffect(() => {
		if (!outcome?.retrying) return;
		const delay =
			AUTO_RETRY_DELAYS[Math.min(autoRetries, AUTO_RETRY_DELAYS.length - 1)];
		const timer = window.setTimeout(() => {
			setAutoRetries((value) => value + 1);
			setAttempt((value) => value + 1);
			setFailedAttempt(null);
			setOutcome(null);
		}, delay);
		return () => window.clearTimeout(timer);
	}, [autoRetries, outcome]);

	useEffect(() => {
		if (!outcome || !RETRYABLE.includes(outcome.kind)) return;
		const onOnline = () => {
			setAutoRetries(0);
			setAttempt((value) => value + 1);
			setFailedAttempt(null);
			setOutcome(null);
			setStarted(true);
		};
		window.addEventListener("online", onOnline);
		return () => window.removeEventListener("online", onOnline);
	}, [outcome]);

	useEffect(() => {
		if (!started || loaded || outcome) return;
		const timer = window.setTimeout(() => {
			setOutcome({
				kind: "timeout",
				retrying: autoRetries < AUTO_RETRY_DELAYS.length,
			});
		}, ATTEMPT_TIMEOUT);
		return () => window.clearTimeout(timer);
	}, [attempt, autoRetries, loaded, outcome, started]);

	useEffect(() => {
		if (failedAttempt === null) return;
		let cancelled = false;
		const url = src ? attemptUrl(src, failedAttempt) : "";
		void classifyFailure(url).then((kind) => {
			if (cancelled) return;
			setOutcome({
				kind,
				retrying:
					RETRYABLE.includes(kind) && autoRetries < AUTO_RETRY_DELAYS.length,
			});
		});
		return () => {
			cancelled = true;
		};
	}, [autoRetries, failedAttempt, src]);

	useEffect(() => {
		const image = imageRef.current;
		if (!image || !started || loaded) return;
		if (!image.complete) return;
		if (image.naturalWidth > 0) {
			setLoaded(true);
			setOutcome(null);
			setFailedAttempt(null);
		} else if (image.currentSrc) {
			setFailedAttempt(attempt);
		}
	}, [attempt, loaded, started]);

	function fail() {
		setLoaded(false);
		setFailedAttempt(attempt);
	}

	function retry() {
		setAutoRetries(0);
		setAttempt((value) => value + 1);
		setFailedAttempt(null);
		setOutcome(null);
		setLoaded(false);
		setStarted(true);
	}

	if (!src) {
		return (
			<span className="my-3 flex min-h-40 w-full items-center justify-center rounded-md border bg-muted/30 px-4 text-center text-xs text-muted-foreground">
				图片地址无效，无法显示。
			</span>
		);
	}

	const failed = !!outcome && !outcome.retrying;
	const busy = started && !loaded && !failed;
	const waiting = !started;
	const currentUrl = attemptUrl(src, attempt);

	return (
		<span
			ref={hostRef}
			aria-busy={busy}
			className={cn(
				"relative my-3 flex w-full max-w-full items-center justify-center overflow-hidden rounded-md",
				loaded ? "min-h-0" : "min-h-40 border bg-muted/30",
				className,
			)}
		>
			{busy && (
				<>
					<span aria-hidden className="absolute inset-0 animate-pulse bg-muted" />
					{(started || waiting) && (
						<span className="relative z-10 flex items-center gap-2 px-4 text-xs text-muted-foreground">
							{started && (
								<LoaderCircle className="size-4 animate-spin" aria-hidden />
							)}
							{outcome?.retrying
								? "网络较慢，正在重新加载图片…"
								: started
									? "图片加载中…"
									: "图片等待加载"}
						</span>
					)}
				</>
			)}
			{started && (
				// eslint-disable-next-line @next/next/no-img-element -- 附件图片必须经鉴权接口读取，不能交给会缓存/改写 URL 的图片优化器。
				<img
					ref={imageRef}
					key={attempt}
					src={currentUrl}
					alt={alt}
					loading={priority ? "eager" : "lazy"}
					decoding="async"
					fetchPriority={priority ? "high" : "auto"}
					onLoad={() => {
						setLoaded(true);
						setOutcome(null);
						setFailedAttempt(null);
					}}
					onError={fail}
					className={cn(
						"relative z-10 h-auto w-auto max-w-full rounded-md border object-contain transition-opacity duration-300",
						loaded
							? "opacity-100"
							: "pointer-events-none absolute opacity-0",
					)}
				/>
			)}
			{failed && outcome && (
				<span
					role="status"
					className="relative z-10 flex max-w-md flex-col items-center gap-2 px-4 py-6 text-center"
				>
					<ImageOff className="size-6 text-muted-foreground" aria-hidden />
					<span className="text-sm font-medium">图片未能显示</span>
					<span className="text-xs leading-5 text-muted-foreground">
						{failureMessages[outcome.kind]}
						{alt ? `（${alt}）` : ""}
					</span>
					<span className="mt-1 flex flex-wrap items-center justify-center gap-2">
						{outcome.kind === "auth" ? (
							<button
								type="button"
								onClick={() => router.push("/login")}
								className="inline-flex h-7 items-center rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent"
							>
								重新登录
							</button>
						) : RETRYABLE.includes(outcome.kind) ? (
							<button
								type="button"
								onClick={retry}
								className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent"
							>
								<RefreshCw className="size-3" aria-hidden />
								再次加载
							</button>
						) : null}
						{RETRYABLE.includes(outcome.kind) && (
							<button
								type="button"
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									window.open(src, "_blank", "noopener,noreferrer");
								}}
								className="text-xs font-medium text-primary underline underline-offset-4"
							>
								查看原图
							</button>
						)}
					</span>
					{offline && (
						<span className="text-xs text-muted-foreground">
							网络已断开，恢复连接后会自动重试。
						</span>
					)}
				</span>
			)}
		</span>
	);
}
