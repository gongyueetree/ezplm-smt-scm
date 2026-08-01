import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from "@/lib/auth/permissions";
import { loadPermissions } from "@/lib/server/permissions";
import { loadConfig } from "@/lib/server/repositories/permission-admin";
import { getSession } from "@/lib/server/session";
import { PermissionEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const session = (await getSession())!;
  const perms = await loadPermissions(session);
  const canManage = perms.has("settings.permissions.manage");

  if (!canManage) {
    return (
      <div>
        <PageHeader path="/settings/permissions" />
        <Banner tone="warn">
          <span>
            你缺少 <span className="mono">settings.permissions.manage</span> 权限 ——
            该权限默认只给管理层。
          </span>
        </Banner>
      </div>
    );
  }

  const config = await loadConfig(session);

  return (
    <div>
      <PageHeader path="/settings/permissions" />
      <Banner tone="soft">
        <span>
          权限判定顺序:<b>角色默认 → 租户额外授予 → 用户级授予/回收</b>,后者覆盖前者。
          <b>角色默认权限来自代码,页面只读</b> —— 改它等于改产品设计,应走代码评审而不是运行时点两下。
          每次变更都写 AuditLog。
        </span>
      </Banner>

      <PermissionEditor
        permissions={[...PERMISSIONS]}
        roleDefaults={ROLE_DEFAULT_PERMISSIONS}
        initial={config}
        currentUserId={session.userId}
      />
    </div>
  );
}
