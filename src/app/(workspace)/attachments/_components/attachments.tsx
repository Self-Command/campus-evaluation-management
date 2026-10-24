"use client";
// Tabs and directory structure adapted from the selected template's users
// page (D/users) and invoice tabs (D/invoice/_components/invoice-form.tsx).
import { useState } from "react";
import { Paperclip, GraduationCap } from "lucide-react";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityAttachments } from "./activity-attachments";
import { StudentEvidence } from "./student-evidence";
import type { OrganizationTree, TermOption } from "./shared";

export function Attachments() {
  const terms = useRemote<TermOption[]>("/api/terms?view=all");
  const orgs = useRemote<OrganizationTree>("/api/organizations");
  const [tab, setTab] = useState("activities");
  const loading = terms.loading || orgs.loading;
  const error = terms.error || orgs.error;

  if (loading || error) {
    return <RemoteState loading={loading} error={error} reload={() => { terms.reload(); orgs.reload(); }} />;
  }
  if (!terms.data || !orgs.data) return <RemoteState loading={false} error="组织或周期数据不可用，请刷新重试。" reload={() => { terms.reload(); orgs.reload(); }} />;

  return (
    <Tabs value={tab} onValueChange={value => setTab(String(value))}>
      <TabsList>
        <TabsTrigger value="activities">
          <Paperclip data-icon="inline-start" />
          活动附件
        </TabsTrigger>
        <TabsTrigger value="evidence">
          <GraduationCap data-icon="inline-start" />
          学生证明
        </TabsTrigger>
      </TabsList>
      <TabsContent value="activities" keepMounted>
        <ActivityAttachments terms={terms.data} orgs={orgs.data} />
      </TabsContent>
      <TabsContent value="evidence" keepMounted>
        <StudentEvidence orgs={orgs.data} />
      </TabsContent>
    </Tabs>
  );
}
