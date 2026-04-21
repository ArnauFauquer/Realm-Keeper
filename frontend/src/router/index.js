import { createRouter, createWebHistory } from 'vue-router'

const Home = () => import('../views/Home.vue')
const NoteView = () => import('../views/NoteView.vue')


const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },

  {
    path: '/note/:notePath(.*)',
    name: 'Note',
    component: NoteView,
    props: true
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
