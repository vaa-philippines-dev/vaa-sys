// Other VAA systems offered in the system switcher and on the admin picker.
// Kept out of the 'use client' switcher so the server layout can read the list.
// Each icon is that system's own favicon, copied into public/ so the menu
// doesn't depend on the other apps being up.
export type SystemLink = { label: string; href: string; icon?: string; about?: string; external?: boolean }

export const CMS_ICON = '/icon.png'
export const LMS_ICON = '/vaaleadms.png'

export const EXTERNAL_SYSTEMS: SystemLink[] = [
  {
    label: 'Workforce Management System',
    href: 'https://workforce-sys.vercel.app/',
    icon: '/workforce-icon.png',
    about: 'VA records, departments and services',
    external: true,
  },
  {
    label: 'KPI Ms',
    href: 'https://kpi-ms-8s5x.vercel.app/',
    icon: '/kpi-icon.png',
    about: 'KPI tracking and reports',
    external: true,
  },
]
