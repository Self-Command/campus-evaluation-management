"use client";
// Field-group adaptation of the selected template's invoice-form/client-selector.
import { useState } from "react";
import Link from "next/link";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import type { OrganizationData } from "@/lib/organization-types";

export function OrganizationFields({
	data,
	initialClassId,
	initialCollegeId,
	collegeOnly = false,
	prefix = "organization",
	onChange,
}: {
	data: OrganizationData;
	initialClassId?: string | null;
	initialCollegeId?: string | null;
	collegeOnly?: boolean;
	prefix?: string;
	onChange?: () => void;
}) {
	const initialCollege = data.colleges.find(
		(c) =>
			c.id === initialCollegeId ||
			c.majors.some((m) => m.classes.some((s) => s.id === initialClassId)),
	);
	const initialMajor = initialCollege?.majors.find((m) =>
		m.classes.some((s) => s.id === initialClassId),
	);
	const [collegeId, setCollegeId] = useState(initialCollege?.id || "");
	const [majorId, setMajorId] = useState(initialMajor?.id || "");
	const [classId, setClassId] = useState(initialClassId || "");
	const college = data.colleges.find((c) => c.id === collegeId);
	const major = college?.majors.find((m) => m.id === majorId);
	const schoolClass = major?.classes.find((s) => s.id === classId);
	return (
		<>
			<Field>
				<FieldLabel htmlFor={`${prefix}-college`}>学院</FieldLabel>
				<NativeSelect
					id={`${prefix}-college`}
					name={collegeOnly ? "collegeId" : undefined}
					required
					value={collegeId}
					onChange={(e) => {
						setCollegeId(e.target.value);
						setMajorId("");
						setClassId("");
						onChange?.();
					}}
				>
					<NativeSelectOption value="">请选择学院</NativeSelectOption>
					{data.colleges
						.filter((c) => c.enabled || c.id === collegeId)
						.map((c) => (
							<NativeSelectOption key={c.id} value={c.id} disabled={!c.enabled}>
								{c.name}
								{!c.enabled ? "（已停用）" : ""}
							</NativeSelectOption>
						))}
				</NativeSelect>
				{!data.colleges.some((c) => c.enabled) && (
					<FieldDescription>
						暂无启用学院。
						{data.canManage ? (
							<Link
								href="/organizations"
								className="underline underline-offset-4"
							>
								前往组织目录配置学院
							</Link>
						) : (
							"请联系学校管理员完善组织目录。"
						)}
					</FieldDescription>
				)}
			</Field>
			{!collegeOnly && (
				<>
					<Field>
						<FieldLabel htmlFor={`${prefix}-major`}>专业</FieldLabel>
						<NativeSelect
							id={`${prefix}-major`}
							required
							disabled={!college?.enabled}
							value={majorId}
							onChange={(e) => {
								setMajorId(e.target.value);
								setClassId("");
								onChange?.();
							}}
						>
							<NativeSelectOption value="">请选择专业</NativeSelectOption>
							{college?.majors
								.filter((m) => m.enabled || m.id === majorId)
								.map((m) => (
									<NativeSelectOption
										key={m.id}
										value={m.id}
										disabled={!m.enabled}
									>
										{m.name}
										{!m.enabled ? "（已停用）" : ""}
									</NativeSelectOption>
								))}
						</NativeSelect>
						{college && !college.majors.some((m) => m.enabled) && (
							<FieldDescription>
								该学院暂无启用专业。
								{data.canManage ? (
									<Link
										href="/organizations"
										className="underline underline-offset-4"
									>
										前往组织目录维护专业
									</Link>
								) : (
									"请联系学院管理人员。"
								)}
							</FieldDescription>
						)}
					</Field>
					<Field>
						<FieldLabel htmlFor={`${prefix}-class`}>班级</FieldLabel>
						<NativeSelect
							id={`${prefix}-class`}
							name="classId"
							required
							disabled={!major?.enabled || !college?.enabled}
							value={classId}
							onChange={(e) => {
								setClassId(e.target.value);
								onChange?.();
							}}
						>
							<NativeSelectOption value="">请选择班级</NativeSelectOption>
							{major?.classes
								.filter((s) => s.enabled || s.id === classId)
								.map((s) => (
									<NativeSelectOption
										key={s.id}
										value={s.id}
										disabled={!s.enabled || !s.counselor}
									>
										{s.name}
										{!s.enabled
											? "（已停用）"
											: !s.counselor
												? "（待分配辅导员）"
												: ""}
									</NativeSelectOption>
								))}
						</NativeSelect>
						<FieldDescription>
							责任辅导员：
							{schoolClass?.counselor
								? `${schoolClass.counselor.name}（${schoolClass.counselor.login}）`
								: "选择已分配辅导员的班级后自动确定"}
						</FieldDescription>
						{major && !major.classes.some((s) => s.enabled && s.counselor) && (
							<FieldDescription>
								该专业暂无可建档班级。
								{data.canManage ? (
									<Link
										href="/organizations"
										className="underline underline-offset-4"
									>
										前往组织目录完善班级及辅导员
									</Link>
								) : (
									"请联系学院管理人员。"
								)}
							</FieldDescription>
						)}
					</Field>
				</>
			)}
		</>
	);
}
