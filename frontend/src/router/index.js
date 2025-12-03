import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import NoteView from '../views/NoteView.vue'
import GraphView from '../views/GraphView.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/graph',
    name: 'Graph',
    component: GraphView
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
