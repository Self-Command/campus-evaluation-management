"use client";

import { useState, type CSSProperties } from "react";

type BrandLogoProps = {
	lightAssetId: string | null;
	darkAssetId: string | null;
	alt: string;
	className?: string;
	style?: CSSProperties;
};

const fallbackClass =
	"inline-flex min-w-0 max-w-full items-center truncate text-sm font-semibold";

export function BrandLogo({
	lightAssetId,
	darkAssetId,
	alt,
	className = "",
	style,
}: BrandLogoProps) {
	const [failedLightId, setFailedLightId] = useState<string | null>(null);
	const [failedDarkId, setFailedDarkId] = useState<string | null>(null);
	const light = lightAssetId ?? darkAssetId;
	const dark = darkAssetId ?? lightAssetId;
	if (!light || !dark) return null;
	const lightFailed = failedLightId === light;
	const darkFailed = failedDarkId === dark;
	const paired = !!lightAssetId && !!darkAssetId && lightAssetId !== darkAssetId;
	if (!paired) {
		if (lightFailed) {
			return (
				<span className={`${fallbackClass} ${className}`} style={style}>
					{alt}
				</span>
			);
		}
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img
				src={`/api/brand-assets/${light}`}
				alt={alt}
				style={style}
				onError={() => setFailedLightId(light)}
				className={`h-auto w-auto object-contain ${className}`}
			/>
		);
	}
	return (
		<>
			{lightFailed ? (
				<span
					className={`theme-logo-light ${fallbackClass} ${className}`}
					style={style}
				>
					{alt}
				</span>
			) : (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={`/api/brand-assets/${light}`}
					alt={alt}
					style={style}
					onError={() => setFailedLightId(light)}
					className={`theme-logo-light h-auto w-auto object-contain ${className}`}
				/>
			)}
			{darkFailed ? (
				<span
					className={`theme-logo-dark ${fallbackClass} ${className}`}
					style={style}
				>
					{alt}
				</span>
			) : (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={`/api/brand-assets/${dark}`}
					alt={alt}
					style={style}
					onError={() => setFailedDarkId(dark)}
					className={`theme-logo-dark h-auto w-auto object-contain ${className}`}
				/>
			)}
		</>
	);
}
