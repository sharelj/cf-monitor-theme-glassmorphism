import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // 路由约定：首页 /#/，详情页 /#/server/:id
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/server/:id',
      name: 'instance-detail',
      component: () => import('@/views/InstanceDetail.vue'),
    },
    {
      path: '/assets',
      name: 'assets',
      component: () => import('@/views/AssetsView.vue'),
    },
    // 旧链接兼容
    { path: '/instance/:id', redirect: to => ({ name: 'instance-detail', params: to.params }) },
    { path: '/node/:id', redirect: to => ({ name: 'instance-detail', params: to.params }) },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
