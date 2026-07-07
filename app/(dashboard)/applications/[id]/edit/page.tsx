import { notFound } from "next/navigation";
import { ApplicationForm } from "@/features/applications/components/application-form";
import { DeleteApplicationButton } from "@/features/applications/components/delete-application-button";
import { getApplicationDetail } from "@/features/applications/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth-guard";
import { toDateInputValue } from "@/lib/date";

export default async function EditApplicationPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const application = await getApplicationDetail(user.id, id);

  if (!application) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">応募先編集</h2>
          <p className="text-sm text-slate-500">
            {application.company.name} / {application.position}
          </p>
        </div>
        <DeleteApplicationButton applicationId={application.id} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationForm
            mode="edit"
            application={{
              id: application.id,
              companyName: application.company.name,
              position: application.position,
              applicationType: application.applicationType,
              route: application.route,
              status: application.status,
              priority: application.priority,
              appliedAt: toDateInputValue(application.appliedAt),
              sourceUrl: application.sourceUrl ?? "",
              note: application.note ?? ""
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
