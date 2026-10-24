import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export type StaffKpi = {
	title: string;
	value: number;
	description: string;
	href: string;
	action: string;
};
// Editing origin: complete dashboard/analytics/_components/analytics-kpi-strip.tsx,
// retaining the single bordered strip, divided cards and title/value/footnote order.
export function StaffKpiStrip({ items }: { items: StaffKpi[] }) {
	return (
		<div className="overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
			<div className="grid divide-y *:data-[slot=card]:rounded-none *:data-[slot=card]:ring-0 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
				{items.map((item) => (
					<Card key={item.title}>
						<CardHeader>
							<CardTitle className="font-normal text-sm">{item.title}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							<div className="text-2xl leading-none tracking-tight tabular-nums">
								{item.value}
							</div>
							<p className="text-xs text-muted-foreground">{item.description}</p>
							<Link
								href={item.href}
								className="text-xs underline underline-offset-4"
							>
								{item.action}
							</Link>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
