Status: ready-for-agent
Blocked by: 01～05

# 06 整体对齐、隔离验证与正式增量迁移

逐页核对完整模板来源、四类工作台、导航及单一职责、高密度真实流程；不留已删除功能入口。执行lint/typecheck/build、隔离集成及独立数据库/附件/端口HTTP，备份并隔离恢复核对原行字段后正式增量迁移，受控重启指定服务并HTTP核对。旧密码和业务不变、不seed覆盖，禁止全局杀进程；浏览器/Excel/WPS由用户验收，Docker仍暂缓。逐批记录通过、失败与未验证，不自动commit/push。
