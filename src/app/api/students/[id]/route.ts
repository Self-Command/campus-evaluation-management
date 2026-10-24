import { authenticatedApi } from "@/server/route-handler";
import { updateStudentProfile } from "@/server/students";
import { deleteStudentAccount, readStudentProfile } from "@/server/accounts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"], async sessionId => {
    const { id } = await context.params;
    return readStudentProfile(sessionId, id);
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN", "COLLEGE"], async sessionId => {
    const { id } = await context.params;
    return updateStudentProfile(sessionId, id, await request.json());
  }, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { id } = await context.params;
    return deleteStudentAccount(sessionId, id, await request.json());
  }, true);
}
