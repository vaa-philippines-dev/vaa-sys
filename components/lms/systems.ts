// Other VAA systems offered in Lead Management's system switcher. Kept out
// of the 'use client' switcher so the server layout can read the list.
export type SystemLink = { label: string; href: string; external?: boolean }

export const EXTERNAL_SYSTEMS: SystemLink[] = [
  { label: 'Workforce Management System', href: 'https://vaa-management-sys.vercel.app/', external: true },
  { label: 'KPI Ms', href: 'https://sites.google.com/vaaphilippines.com/kbms/home', external: true },
]
