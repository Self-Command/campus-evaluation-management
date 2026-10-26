"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RemoteState<T> = { url: string; data: T | null; error: string };

export function useRemote<T>(url: string | null, initialData?: T) {
	const router = useRouter();
	const [version, setVersion] = useState(0);
	const [state, setState] = useState<RemoteState<T> | null>(() =>
		url && initialData !== undefined
			? { url, data: initialData, error: "" }
			: null,
	);
	const reload = useCallback(() => setVersion((v) => v + 1), []);
	useEffect(() => {
		if (!url) return;
		const controller = new AbortController();
		fetch(url, { cache: "no-store", signal: controller.signal })
			.then(async (response) => {
				const value = await response.json();
				if (!response.ok) {
					if (response.status === 401) router.replace("/login");
					throw new Error(value.error || value.message || "读取失败，请重试");
				}
				return value as T;
			})
			.then((data) => {
				if (!controller.signal.aborted) setState({ url, data, error: "" });
			})
			.catch((error) => {
				if (controller.signal.aborted) return;
				setState((current) =>
					current?.url === url
						? { ...current, error: error.message }
						: { url, data: null, error: error.message },
				);
			});
		return () => controller.abort();
	}, [url, version, router]);
	const current = state?.url === url ? state : null;
	return {
		data: current?.data ?? null,
		loading: !!url && !current,
		error: current?.error || "",
		reload,
	};
}
