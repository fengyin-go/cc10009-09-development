import { createRouter, createWebHistory } from 'vue-router'

import Overview from '@/views/Overview.vue'
const Site = () => import('@/views/site/index.vue')
const Template = () => import('@/views/template/index.vue')
const Proxy = () => import('@/views/proxy/index.vue')
const Spider = () => import('@/views/spider/index.vue')
const Schedule = () => import('@/views/schedule/index.vue')
const Antibot = () => import('@/views/antibot/index.vue')
const Ratelimit = () => import('@/views/ratelimit/index.vue')
const Retry = () => import('@/views/retry/index.vue')
const Extractor = () => import('@/views/extractor/index.vue')
const Pipeline = () => import('@/views/pipeline/index.vue')
const Validator = () => import('@/views/validator/index.vue')
const Storage = () => import('@/views/storage/index.vue')
const Monitor = () => import('@/views/monitor/index.vue')
const Cleanse = () => import('@/views/cleanse/index.vue')
const Delta = () => import('@/views/delta/index.vue')
const Export = () => import('@/views/export/index.vue')
const Rpaflow = () => import('@/views/rpaflow/index.vue')
const Auth = () => import('@/views/auth/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview },
    { path: '/site', name: 'site', component: Site },
    { path: '/template', name: 'template', component: Template },
    { path: '/proxy', name: 'proxy', component: Proxy },
    { path: '/spider', name: 'spider', component: Spider },
    { path: '/schedule', name: 'schedule', component: Schedule },
    { path: '/antibot', name: 'antibot', component: Antibot },
    { path: '/ratelimit', name: 'ratelimit', component: Ratelimit },
    { path: '/retry', name: 'retry', component: Retry },
    { path: '/extractor', name: 'extractor', component: Extractor },
    { path: '/pipeline', name: 'pipeline', component: Pipeline },
    { path: '/validator', name: 'validator', component: Validator },
    { path: '/storage', name: 'storage', component: Storage },
    { path: '/monitor', name: 'monitor', component: Monitor },
    { path: '/cleanse', name: 'cleanse', component: Cleanse },
    { path: '/delta', name: 'delta', component: Delta },
    { path: '/export', name: 'export', component: Export },
    { path: '/rpaflow', name: 'rpaflow', component: Rpaflow },
    { path: '/auth', name: 'auth', component: Auth },
  ],
})

export default router
