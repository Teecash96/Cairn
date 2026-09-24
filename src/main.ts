import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import UsageDashboard from './components/UsageDashboard.vue'

const usagePage = window.location.pathname === '/usage'
if (usagePage) {
  document.title = 'Cairn public usage evidence'
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute(
    'content',
    'Privacy-safe evidence of verified wallets, meaningful Cairn actions, team work, and direct NIM rewards.',
  )
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', `${window.location.origin}/usage`)
}

createApp(usagePage ? UsageDashboard : App).mount('#app')
