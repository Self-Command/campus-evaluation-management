import type { CSSProperties } from "react";

type BrandLogoProps = {
	lightAssetId: string | null;
	darkAssetId: string | null;
	alt: string;
	className?: string;
	style?: CSSProperties;
};

export function BrandLogo({
	lightAssetId,
	darkAssetId,
	alt,
	className = "",
	style,
}: BrandLogoProps) {
	const light = lightAssetId ?? darkAssetId;
	const dark = darkAssetId ?? lightAssetId;
	if (!light || !dark) return null;
	const paired = !!lightAssetId && !!darkAssetId && lightAssetId !== darkAssetId;
	if (!paired) {
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img
				src={`/api/brand-assets/${light}`}
				alt={alt}
				style={style}
				className={`h-auto w-auto object-contain ${className}`}
			/>
		);
	}
	return (
		<>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img
				src={`/api/brand-assets/${light}`}
				alt={alt}
				style={style}
				className={`theme-logo-light h-auto w-auto object-contain ${className}`}
			/>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img
				src={`/api/brand-assets/${dark}`}
				alt={alt}
				style={style}
				className={`theme-logo-dark h-auto w-auto object-contain ${className}`}
			/>
		</>
	);
}
