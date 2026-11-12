<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">网页采集配置管理工具</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">离线版采集配置管理工具，涵盖站点管理、抽取模板编排、代理池配置、限速策略、重试机制、增量采集与数据落盘规则，所有配置持久化到浏览器本地存储。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "站点管理", path: "/site" }, { label: "抽取模板", path: "/template" }, { label: "代理池管理", path: "/proxy" }, { label: "采集任务", path: "/spider" }, { label: "调度策略", path: "/schedule" }, { label: "反爬对抗", path: "/antibot" }, { label: "限速控制", path: "/ratelimit" }, { label: "失败重试", path: "/retry" }, { label: "字段映射", path: "/extractor" }, { label: "采集流水线", path: "/pipeline" }, { label: "结果校验", path: "/validator" }, { label: "数据落盘", path: "/storage" }, { label: "采集监控", path: "/monitor" }, { label: "数据清洗", path: "/cleanse" }, { label: "增量采集", path: "/delta" }, { label: "数据分发", path: "/export" }, { label: "RPA流程", path: "/rpaflow" }, { label: "登录凭证", path: "/auth" }]
</script>
